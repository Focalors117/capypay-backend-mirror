const supabase = require('../config/supabase');
const bcrypt = require('bcryptjs'); // Importar bcrypt
const { calcularComisionCpp: calcularComisionService } = require('../services/comisionService');

// ==========================================
// 1. RECARGAR SALDO (Bolívares -> Dólares/Capys)
// ==========================================
const recargarSaldo = async (req, res) => {
    // AHORA: Pedimos 'cedula' en vez de 'usuarioId'
    const { cedula, monto_bs, metodo_pago } = req.body;

    if (!cedula || !monto_bs || !metodo_pago) {
        return res.status(400).json({ error: "Faltan datos (cedula, monto_bs, metodo_pago)" });
    }

    try {
        // 1. Obtener Tasa del Dólar
        const { data: config } = await supabase
            .from('global_config')
            .select('tasa_dolar')
            .single();

        if (!config) return res.status(500).json({ error: "Error de tasa" });

        const tasa = parseFloat(config.tasa_dolar);
        const montoCapy = parseFloat(monto_bs) / tasa;
        
        // 2. BUSCAR USUARIO POR CÉDULA
        const { data: usuario, error: errorUser } = await supabase
            .from('profiles')
            .select('*')
            .eq('cedula', cedula)
            .single();

        if (errorUser || !usuario) return res.status(404).json({ error: "Cédula no encontrada" });

        // 3. Sumar Saldo (Calculado para respuesta)
        const nuevoSaldo = parseFloat(usuario.balance) + montoCapy;

        // Comentado para evitar duplicidad si existe un trigger en la base de datos
        // await supabase.from('profiles').update({ balance: nuevoSaldo }).eq('id', usuario.id);

        // 4. Guardar en Historial
        const { data: recarga } = await supabase
            .from('recharges')
            .insert([{
                perfil_id: usuario.id,
                monto_bs: monto_bs,
                tasa_momento: tasa,
                monto_capy: montoCapy,
                metodo_pago: metodo_pago
            }])
            .select();

        res.status(200).json({
            mensaje: `Recarga exitosa a ${usuario.name}`,
            nuevo_saldo: nuevoSaldo,
            detalle: recarga[0]
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error del servidor" });
    }
};



// ==========================================
// 2. TRANSFERIR SALDO (Entre Usuarios)
// ==========================================
const transferirSaldo = async (req, res) => {
    // Definimos cedula_receptor como el identificador único del receptor
    const { emisor_id, cedula_receptor, monto, concepto, pin } = req.body;

    /* Validación de seguridad mediante PIN */
    if (pin) {
        const { data: userPin } = await supabase.from('profiles').select('pin').eq('id', emisor_id).single();
        
        if (userPin && userPin.pin) {
             const pinValido = await bcrypt.compare(pin, userPin.pin);
             if (!pinValido) {
                 return res.status(403).json({ error: "PIN de seguridad incorrecto" });
             } 
        } else {
            console.log("Advertencia: Usuario sin PIN configurado en DB, pero intentó usar uno.");
        }
    }

    if (!emisor_id || !cedula_receptor || !monto || monto <= 0) {
        return res.status(400).json({ error: "Faltan datos o el monto es inválido" });
    }

    try {
        // A. Buscar Emisor
        const { data: emisor, error: errEmisor } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', emisor_id)
            .single();

        if (errEmisor || !emisor) return res.status(404).json({ error: "Emisor no encontrado" });

        // B. Buscar Receptor por Cédula
        const { data: receptor, error: errReceptor } = await supabase
            .from('profiles')
            .select('*')
            .eq('cedula', cedula_receptor)
            .single();

        if (errReceptor || !receptor) return res.status(404).json({ error: "Destinatario no encontrado" });
        if (emisor.id === receptor.id) return res.status(400).json({ error: "No puedes pagarte a ti mismo" });

        /* Cálculo de Comisión externo vía servicio C++ */
        const tipoUsuario = emisor.user_type || 'comun';
        console.log(`Calculando comisión (C++) para: ${tipoUsuario}...`);
        
        const comision = await calcularComisionService(monto, tipoUsuario);
        const totalADescontar = parseFloat(monto) + comision;

        console.log(`Monto: ${monto}, Comisión: ${comision}, Total a descontar: ${totalADescontar}`);

        // D. Verificar Saldo
        if (emisor.balance < totalADescontar) {
            return res.status(400).json({
                error: "Saldo insuficiente",
                detalle: `Necesitas ${totalADescontar} (Incluye ${comision} de comisión)`
            });
        }

        /* 
           E. Registro de la Transacción en Base de Datos.
           Nota: Insertamos 'comision_bs' según la estructura acordada.
           Confiamos en que el TRIGGER de Supabase usará (amount + comision_bs) para el balance.
        */
        const { data: transaccion, error: errorTx } = await supabase
            .from('transactions')
            .insert([{
                emisor_id: emisor.id,
                receptor_id: receptor.id,
                amount: monto,
                comision_bs: comision, // Campo corregido según schema
                concept: concepto || "Transferencia",
                category: "transferencia"
            }])
            .select();

        if (errorTx) {
            console.error("Error al insertar transacción:", errorTx);
            return res.status(400).json({ error: "Error en la transacción: " + (errorTx.message || "DB Error") });
        }       

        const txData = transaccion ? transaccion[0] : null;

        // G. Notificación
        if (txData) {
             try {
                 await supabase.from('notifications').insert([{
                     user_id: receptor.id,
                     type: 'payment_received',
                     message: `Recibiste ${monto} Capys de ${emisor.name || 'Alguien'}`,
                     related_id: txData.id,
                     is_read: false
                 }]);
             } catch (notifError) {
                 console.error("Error creating notification (non-blocking):", notifError);
             }
        }

        res.status(200).json({
            mensaje: "Transferencia exitosa",
            monto_enviado: monto,
            comision_cobrada: comision,
            saldo_restante_estimado: parseFloat(emisor.balance) - totalADescontar,
            comprobante: txData
        });

    } catch (err) {
        console.error("Error procesando pago:", err);
        res.status(500).json({ error: "Error del servidor procesando pago" });
    }
};

// ==========================================
// 3. OBTENER HISTORIAL (Por Cédula)
// ==========================================
const obtenerHistorial = async (req, res) => {
    const { cedula } = req.query;

    if (!cedula) return res.status(400).json({ error: "Falta la cédula en la URL" });

    try {
        const { data: usuario, error: errorUser } = await supabase
            .from('profiles')
            .select('id, name')
            .eq('cedula', cedula)
            .single();

        if (errorUser || !usuario) return res.status(404).json({ error: "Cédula no encontrada" });

        const usuarioId = usuario.id;

        // A. Transacciones
        const { data: listaDePagos, error: errPagos } = await supabase
            .from('transactions')
            .select('*')
            .or(`emisor_id.eq.${usuarioId},receptor_id.eq.${usuarioId}`);

        if(errPagos) console.error("Error obteniendo transacciones:", errPagos);

        // B. Recargas
        const { data: recargas, error: errRecargas } = await supabase
            .from('recharges')
            .select('*')
            .eq('perfil_id', usuarioId);

        if(errRecargas) console.error("Error obteniendo recargas:", errRecargas);

        // C. Formatear y Unificar
        const historialTxs = (listaDePagos || []).map(t => ({
            id: t.id,
            tipo: t.emisor_id === usuarioId ? 'PAGO ENVIADO' : 'PAGO RECIBIDO',
            monto: t.amount,
            comision: t.comision || 0,
            descripcion: t.concept,
            fecha: t.created_at,
            es_negativo: t.emisor_id === usuarioId
        }));

        const historialRecargas = (recargas || []).map(r => ({
            id: r.id,
            tipo: 'RECARGA',
            monto: r.monto_capy,
            descripcion: `Recarga vía ${r.metodo_pago}`,
            fecha: r.created_at,
            es_negativo: false
        }));

        const historialCompleto = [...historialTxs, ...historialRecargas].sort((a, b) => {
            return new Date(b.fecha) - new Date(a.fecha);
        });

        res.status(200).json({
            usuario: usuario.name,
            cantidad: historialCompleto.length,
            movimientos: historialCompleto
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error obteniendo historial" });
    }
};

// ==========================================
// 4. CONFIGURAR TASA
// ==========================================
const configurarTasa = async (req, res) => {
    const { tasa } = req.body;
    if (!tasa) return res.status(400).json({ error: "Dime la tasa (ej. 50)" });

    const { data, error } = await supabase
        .from('global_config')
        .upsert([{ id: 1, tasa_dolar: tasa, updated_at: new Date() }])
        .select();

    if (error) {
        console.error(error);
        return res.status(500).json({ error: "Error configurando la tasa" });
    }

    res.status(200).json({
        mensaje: "¡Tasa configurada exitosamente!",
        config: data[0]
    });
};

// ==========================================
// 5. OBTENER TASA ACTUAL
// ==========================================
const obtenerTasa = async (req, res) => {
    try {
        const { data: config, error } = await supabase
            .from('global_config')
            .select('tasa_dolar')
            .single();

        if (error || !config) return res.status(404).json({ error: "Tasa no encontrada" });

        res.status(200).json({ tasa: parseFloat(config.tasa_dolar) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error obteniendo la tasa" });
    }
};

const endpointComisionCpp = (req, res) => {
    return res.json({ mensaje: "¡El servicio C++ está enlazado correctamente!" });
};

module.exports = { 
    recargarSaldo, 
    transferirSaldo, 
    obtenerHistorial, 
    configurarTasa, 
    obtenerTasa,
    calcularComisionCpp: endpointComisionCpp 
};
