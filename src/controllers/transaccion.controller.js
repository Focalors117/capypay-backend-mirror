const userDB = require('../models/user.model'); 

const transaccionesDB = require('../models/transaccion.model');

//  Funcion para Recargar (meter dinero)
const recargarSaldo = (req, res) => {
    const { usuarioId, monto } = req.body;

    // validación de datos
    if (!usuarioId || !monto) {
        return res.status(400).json({ error: "Faltan datos (usuarioId, monto)" });
    }
    
    // buscamos al usuario usando userDB
    const usuario = userDB.find(user => user.id === usuarioId);
    
    if (!usuario) {
        return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // sumamos 
    usuario.saldo += parseFloat(monto);

    // funcion para registrar la transaccion (historial)
    const nuevaTransaccion = {
        id: transaccionesDB.length + 1,
        tipo : 'RECARGA',
        usuarioId : usuarioId,
        monto : parseFloat(monto),
        fecha : new Date().toISOString() // fecha y ora actual en formato ISO
    };
    transaccionesDB.push(nuevaTransaccion); // guardamos la transaccion

    res.status(200).json({
        mensaje: "Recarga exitosa",
        nuevo_saldo: usuario.saldo,
        transaccion: nuevaTransaccion // devolvemos los datos de la transaccion
    });
};

// 2. función para Transferir (mover dinero)
const transferirSaldo = (req, res) => {
    const { origenId, destinoId, monto } = req.body;

    // validacion
    if (!origenId || !destinoId || !monto) {
        return res.status(400).json({ error: "Faltan datos obligatorios" });
    }
    
    if (origenId === destinoId) {
        return res.status(400).json({ error: "No puedes transferirte a ti mismo" });
    }
    
    if (monto <= 0) {
        return res.status(400).json({ error: "El monto debe ser positivo" });
    }

    // Buscar usuarios en la misma userDB
    const usuarioOrigen = userDB.find(user => user.id === origenId);
    const usuarioDestino = userDB.find(user => user.id === destinoId);

    if (!usuarioOrigen || !usuarioDestino) {
        return res.status(404).json({ error: "Uno de los usuarios no existe" });
    }

    // verificar fondos
    if (usuarioOrigen.saldo < monto) {
        return res.status(400).json({ error: "Saldo insuficiente" });
    }

    // ejecutar transacción
    usuarioOrigen.saldo -= parseFloat(monto);
    usuarioDestino.saldo += parseFloat(monto);

    const nuevaTransaccion = {
        id: transaccionesDB.length + 1,
        tipo: 'TRANSFERENCIA',
        origenId: origenId,
        destinoId: destinoId,
        monto: parseFloat(monto),
        fecha: new Date().toISOString()
    };
    transaccionesDB.push(nuevaTransaccion);

    res.status(200).json({
        mensaje: "Transferencia exitosa",
        transaccion: nuevaTransaccion
    });

};

const obtenerHistorial = (req, res) => {
    const { usuarioId} = req.query; // se pedira por url ?usuarioId=2

    if (!usuarioId) return res.status(400).json({ error: "Falta el ID de usuario" });
    
    const historial = transaccionesDB.filter(t =>
        t.usuarioId == usuarioId ||
        t.origenId == usuarioId ||
        t.destinoId == usuarioId
    );

    res.status(200).json({
        mensaje: "Historial de transacciones",
        cantidad: historial.length,
        movimientos: historial
    });
};

module.exports = { recargarSaldo, transferirSaldo, obtenerHistorial };