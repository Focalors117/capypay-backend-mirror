const supabase = require('../config/supabase'); 

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
        console.log(`[RECARGA] Tasa DB: ${tasa} | Monto Bs Recibido: ${monto_bs}`);
        
        const montoCapy = parseFloat(monto_bs) / tasa; 
        console.log(`[RECARGA] Monto Capy Calculado: ${montoCapy}`);

        // 2. BUSCAR USUARIO POR CÉDULA (La mejora)
        const { data: usuario, error: errorUser } = await supabase
            .from('profiles')
            .select('*') // Traemos todo, incluido el ID y el Balance
            .eq('cedula', cedula) // <--- Aquí está el truco
            .single();

        if (errorUser || !usuario) return res.status(404).json({ error: "Cédula no encontrada" });

        // 3. Sumar Saldo (Usamos el ID que acabamos de encontrar)
        const nuevoSaldo = parseFloat(usuario.balance) + montoCapy;

        // Comentado para evitar duplicidad si existe un trigger en la base de datos
        // await supabase.from('profiles').update({ balance: nuevoSaldo }).eq('id', usuario.id);

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
const transferirSaldo = async (req, res) => {
    const { emisor_id, cedula_receptor, monto, concepto } = req.body;

    if (!emisor_id || !cedula_receptor || !monto) {
        return res.status(400).json({ error: "Faltan datos" });
    }

    try {
        // A. Buscar Emisor (Quien paga)
        const { data: emisor } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', emisor_id)
            .single();

        if (!emisor) return res.status(404).json({ error: "Emisor no encontrado" });
        if (emisor.balance < monto) return res.status(400).json({ error: "Saldo insuficiente" });

        // B. Buscar Receptor por CÉDULA
        const { data: receptor } = await supabase
            .from('profiles')
            .select('*')
            .eq('cedula', cedula_receptor)
            .single();

        if (!receptor) return res.status(404).json({ error: "Destinatario no encontrado" });
        if (emisor.id === receptor.id) return res.status(400).json({ error: "No puedes pagarte a ti mismo" });

        // C. Ejecutar Movimiento de Dinero
        // Calculo esto solo en el JSON de respuesta (Visual),
        // pero NO lo mandamos a guardar a la DB
        const saldoEmisorRestante = parseFloat(emisor.balance) - parseFloat(monto);
        
        // --- EVITAMOS QUE NODEJS TOQUE EL SALDO PORQUE LA DB YA LO HACE ---
        // await supabase.from('profiles').update({ balance: saldoEmisorRestante }).eq('id', emisor.id);
        // const saldoReceptorNuevo = parseFloat(receptor.balance) + parseFloat(monto);
        // await supabase.from('profiles').update({ balance: saldoReceptorNuevo }).eq('id', receptor.id);
        // -----------------------------------------------------------------------------

        // D. Guardar Registro (Esto disparara el trigger de la DB)
        const { data: transaccion } = await supabase
            .from('transactions')
            .insert([{
                emisor_id: emisor.id,
                receptor_id: receptor.id,
                amount: monto,
                concept: concepto || "Transferencia",
                category: "general"
            }])
            .select();

        res.status(200).json({
            mensaje: "Transferencia exitosa",
            nuevo_saldo_estimado: saldoEmisorRestante, // Esto es un estimado local
            comprobante: transaccion[0]
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error del servidor" });
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
        const historialTxs = (listaDePagos| []).map(t => ({
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

module.exports = { recargarSaldo, transferirSaldo, obtenerHistorial, configurarTasa, obtenerTasa };