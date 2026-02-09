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

        // 5. Asignar XP (Gamificación: +10 XP por Recarga)
        try {
             // Simulamos incremento (en producción usarías una funcion RPC de base de datos)
             const nuevaXP = (usuario.xp || 0) + 10;
             await supabase.from('profiles').update({ xp: nuevaXP }).eq('id', usuario.id);
             console.log(`XP asignada a ${usuario.name}: +10 XP`);
        } catch (xpErr) {
             console.error("Error sumando XP:", xpErr);
        }

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
        
        // --- CAMBIO: Comisiones desactivadas para transferencias entre usuarios ---
        // console.log(`Calculando comisión (C++) para: ${tipoUsuario}...`);
        // const comision = await calcularComisionService(monto, tipoUsuario);
        
        const comision = 0; // Comisión forzada a 0 para P2P
        const totalADescontar = parseFloat(monto) + comision;

        console.log(`Monto: ${monto}, Comisión inv (P2P): ${comision}, Total a descontar: ${totalADescontar}`);

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

        // H. Asignar XP al Emisor (+5 XP por Transferencia)
        try {
            const nuevaXP = (emisor.xp || 0) + 5;
            await supabase.from('profiles').update({ xp: nuevaXP }).eq('id', emisor.id);
            console.log(`XP asignada a emisor ${emisor.name}: +5 XP`);
        } catch (xpErr) {
            console.error("Error sumando XP en transferencia:", xpErr);
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

        // B.5. Órdenes de Comedor (NUEVO)
        const { data: ordenes, error: errOrdenes } = await supabase
            .from('orders')
            .select('*, order_items(quantity, price_at_time)')
            .eq('user_id', usuarioId);

        if(errOrdenes) console.error("Error obteniendo ordenes:", errOrdenes);

        // C. Formatear y Unificar
        // Usamos flatMap para desdoblar transacciones que tengan comisión en 2 filas
        const historialTxs = (listaDePagos || []).flatMap(t => {
            const esEmisor = t.emisor_id === usuarioId;
            const comision = parseFloat(t.comision_bs || 0);
            
            // 1. La transacción principal
            const movimientos = [{
                id: t.id,
                tipo: esEmisor ? 'PAGO ENVIADO' : 'PAGO RECIBIDO',
                monto: t.amount,
                descripcion: t.concept,
                fecha: t.created_at,
                es_negativo: esEmisor
            }];

            // 2. Si soy el emisor y hubo comisión, agrego el movimiento de comisión aparte
            if (esEmisor && comision > 0) {
                movimientos.unshift({ // unshift para que salga antes (o después según sort)
                    id: `${t.id}-comision`, // ID sintético único
                    tipo: 'COMISIÓN SERVICIO',
                    monto: comision,
                    descripcion: 'Comisión por transferencia',
                    fecha: t.created_at, // Misma fecha
                    es_negativo: true
                });
            }

            return movimientos;
        });

        const historialRecargas = (recargas || []).map(r => ({
            id: r.id,
            tipo: 'RECARGA',
            monto: r.monto_capy,
            descripcion: `Recarga vía ${r.metodo_pago}`,
            fecha: r.created_at,
            es_negativo: false
        }));

        const historialOrdenes = (ordenes || []).map(o => {
             // Fallback: Calcular total si no existe en la columna principal
             let finalAmount = parseFloat(o.total || o.total_price || o.amount || 0);

             if (finalAmount === 0 && o.order_items && o.order_items.length > 0) {
                 const subtotal = o.order_items.reduce((acc, i) => {
                     const p = parseFloat(i.price_at_time || 0); // Removed i.price check
                     return acc + (p * (i.quantity || 1));
                 }, 0);
                 // Estimación de comisión si no está guardada (5%)
                 if (subtotal > 0) finalAmount = subtotal + Math.round(subtotal * 0.05);
             }

             return {
                id: o.id,
                tipo: 'CONSUMO',
                monto: finalAmount,
                descripcion: 'Pedido Comedor',
                fecha: o.created_at,
                es_negativo: true
            };
        });

        const historialCompleto = [...historialTxs, ...historialRecargas, ...historialOrdenes].sort((a, b) => {
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
