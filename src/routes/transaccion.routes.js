const express = require('express');

const router = express.Router();

const transaccionController = require('../controllers/transaccion.controller');

//routes
router.post('/recargar', transaccionController.recargarSaldo);
//http://localhost:3000/api/v1/transaccion/recargar

router.post('/transferir', transaccionController.transferirSaldo);
//http://localhost:3000/api/v1/transaccion/transferir

router.get('/historial', transaccionController.obtenerHistorial);
//http://localhost:3000/api/v1/transaccion/historial

router.post('/config-tasa', transaccionController.configurarTasa);

router.post('/calcular-comision', transaccionController.calcularComisionCpp);

module.exports = router;