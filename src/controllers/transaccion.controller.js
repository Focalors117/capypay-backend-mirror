const userDB = require('../models/user.model'); 

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

    res.status(200).json({
        mensaje: "Recarga exitosa",
        nuevo_saldo: usuario.saldo
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

    res.status(200).json({
        mensaje: "Transferencia exitosa",
        origen: usuarioOrigen.nombre,
        destino: usuarioDestino.nombre,
        monto_transferido: monto,
        saldo_restante_origen: usuarioOrigen.saldo
    });
};

module.exports = { recargarSaldo, transferirSaldo };