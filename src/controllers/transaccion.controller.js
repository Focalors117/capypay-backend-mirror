const supabase = require('../config/supabase');
const { exec } = require('child_process');
const path = require('path');

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

        // 2. BUSCAR USUARIO POR CÉDULA (La mejora)
        const { data: usuario, error: errorUser } = await supabase
            .from('profiles')
            .select('*') // Traemos todo, incluido el ID y el Balance
            .eq('cedula', cedula) // <--- Aquí está el truco
            .single();

        if (errorUser || !usuario) return res.status(404).json({ error: "Cédula no encontrada" });

        // 3. Sumar Saldo (Usamos el ID que acabamos de encontrar)
        const nuevoSaldo = parseFloat(usuario.balance) + montoCapy;

        await supabase.from('profiles').update({ balance: nuevoSaldo }).eq('id', usuario.id);

        // 4. Guardar en Historial
        const { data: recarga } = await supabase
            .from('recharges')
            .insert([{
                perfil_id: usuario.id, // Usamos el ID interno
                monto_bs: monto_bs,
                tasa_momento: tasa,
                monto_capy: montoCapy,
                metodo_pago: metodo_pago
            }])
            .select();

        res.status(200).json({
            mensaje: `Recarga exitosa a ${usuario.name}`, // Confirmamos el nombre para que sepas quién fue
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
const { calcularComisionCpp } = require('../services/comisionService');

const transferirSaldo = async (req, res) => {
    // 1. Recibimos los datos del App
    const { emisor_id, receptor_cedula, monto } = req.body;

    // Validación básica
    if (!emisor_id || !receptor_cedula || !monto || monto <= 0) {
        return res.status(400).json({ error: "Faltan datos o el monto es inválido" });
    }

    try {
        // ---------------------------------------------------------
        // PASO A: Obtener datos del EMISOR (Quien envía)
        // ---------------------------------------------------------
        const { data: emisor, error: errEmisor } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', emisor_id)
            .single();

        if (errEmisor || !emisor) return res.status(404).json({ error: "Emisor no encontrado" });

        // ---------------------------------------------------------
        // PASO B: Obtener datos del RECEPTOR (Quien recibe)
        // ---------------------------------------------------------
        // Buscamos por cédula (asumiendo que tienes una columna 'cedula' o 'dni')
        const { data: receptor, error: errReceptor } = await supabase
            .from('profiles')
            .select('*')
            .eq('cedula', receptor_cedula)
            .single();

        if (errReceptor || !receptor) return res.status(404).json({ error: "Destinatario no encontrado" });


        const tipoUsuario = emisor.user_type || 'comun';

        console.log(`Calculando comisión con C++ para usuario: ${tipoUsuario}...`);
        const comision = await calcularComisionCpp(monto, tipoUsuario);

        const totalADescontar = parseFloat(monto) + comision;

        console.log(`Monto: ${monto}, Comisión C++: ${comision}, Total: ${totalADescontar}`);

        // ---------------------------------------------------------
        // PASO D: Verificar si tiene saldo suficiente
        // ---------------------------------------------------------
        if (emisor.balance < totalADescontar) {
            return res.status(400).json({
                error: "Saldo insuficiente",
                detalle: `Necesitas ${totalADescontar} (Incluye ${comision} de comisión)`
            });
        }

        // ---------------------------------------------------------
        // PASO E: Ejecutar la Transacción (Restar y Sumar)
        // ---------------------------------------------------------

        // 1. Restar al Emisor (Monto + Comisión)
        const { error: errUpdateEmisor } = await supabase
            .from('profiles')
            .update({ balance: emisor.balance - totalADescontar })
            .eq('id', emisor_id);

        if (errUpdateEmisor) throw errUpdateEmisor;

        // 2. Sumar al Receptor (Solo el Monto, la comisión se "quema")
        const { error: errUpdateReceptor } = await supabase
            .from('profiles')
            .update({ balance: receptor.balance + parseFloat(monto) })
            .eq('id', receptor.id);

        if (errUpdateReceptor) throw errUpdateReceptor;

        // 3. Guardar el registro en el historial (Opcional pero recomendado)
        await supabase.from('transactions').insert([
            {
                emisor_id: emisor_id,
                receptor_id: receptor.id,
                amount: monto,
                comision: comision, // Si tienes columna comisión, genial. Si no, quita esta línea.
                concept: 'Transferencia entre usuarios',
                category: 'transferencia'
            }
        ]);

        // ---------------------------------------------------------
        // PASO F: Responder éxito
        // ---------------------------------------------------------
        res.status(200).json({
            mensaje: "Transferencia Exitosa ✅",
            monto_enviado: monto,
            comision_cbrada: comision,
            saldo_restante: emisor.balance - totalADescontar
        });

    } catch (error) {
        console.error("Error en transferencia:", error);
        res.status(500).json({ error: "Error procesando la transacción" });
    }
};


// ==========================================
// 3. OBTENER HISTORIAL COMPLETO
// ==========================================
// ==========================================
// 3. OBTENER HISTORIAL (Por Cédula)
// ==========================================
const obtenerHistorial = async (req, res) => {
    // AHORA: Recibimos 'cedula' por la URL en vez del ID raro
    const { cedula } = req.query;

    if (!cedula) return res.status(400).json({ error: "Falta la cédula en la URL (ej. ?cedula=V-1234)" });

    try {
        // PASO EXTRA: Buscar el ID usando la Cédula
        const { data: usuario, error: errorUser } = await supabase
            .from('profiles')
            .select('id, name') // Traemos el nombre también para saludar
            .eq('cedula', cedula)
            .single();

        if (errorUser || !usuario) return res.status(404).json({ error: "Cédula no encontrada" });

        const usuarioId = usuario.id; // ¡Aquí tenemos el ID que necesitamos!

        // AHORA SÍ: Buscamos las transacciones con ese ID (Igual que antes)

        // A. Transacciones (Pagos y Cobros)
        const { data: listaDePagos } = await supabase
            .from('transactions')
            .select('*')
            .or(`emisor_id.eq.${usuarioId},receptor_id.eq.${usuarioId}`);

        // B. Recargas
        const { data: recargas } = await supabase
            .from('recharges')
            .select('*')
            .eq('perfil_id', usuarioId);

        // C. Formatear y Unificar
        const historialTxs = (listaDePagos | []).map(t => ({
            id: t.id,
            tipo: t.emisor_id === usuarioId ? 'PAGO ENVIADO' : 'PAGO RECIBIDO',
            monto: t.amount,
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
            usuario: usuario.name, // Le confirmamos de quién es el historial
            cantidad: historialCompleto.length,
            movimientos: historialCompleto
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error obteniendo historial" });
    }
};

// ==========================================
// 4. CONFIGURAR TASA (Para inicializar la DB)
// ==========================================txs
const configurarTasa = async (req, res) => {
    const { tasa } = req.body; // Ejem: { "tasa": 60 }

    if (!tasa) return res.status(400).json({ error: "Dime la tasa (ej. 50)" });

    // "upsert" significa: Si el ID 1 existe, actualízalo. Si no, créalo.
    const { data, error } = await supabase
        .from('global_config')
        .upsert([
            {
                id: 1, // Siempre usaremos el ID 1 para la configuración global
                tasa_dolar: tasa,
                updated_at: new Date()
            }
        ])
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

exports.calcularComisionCpp = (req, res) => {
    console.log("🟢 La petición llegó al controlador!");
    // Respondemos inmediatamente sin hacer nada más
    return res.json({ mensaje: "¡ESTOY VIVO!" });
};

module.exports = {
    recargarSaldo,
    transferirSaldo,     // Esta es la que acabas de modificar con C++
    obtenerHistorial,
    configurarTasa,
    calcularComisionCpp
};