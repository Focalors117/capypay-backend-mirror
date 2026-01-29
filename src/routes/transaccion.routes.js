const express = require('express');

const router = express.Router();

const transaccionController = require('../controllers/transaccion.controller');

//routes
// http://localhost:3000/api/v1/transaccion/recargar
router.post('/recargar', transaccionController.recargarSaldo);

// http://localhost:3000/api/v1/transaccion/transferir
router.post('/transferir', transaccionController.transferirSaldo);

// http://localhost:3000/api/v1/transaccion/historial
router.get('/historial', transaccionController.obtenerHistorial);

router.post('/config-tasa', transaccionController.configurarTasa);

router.get('/tasa', transaccionController.obtenerTasa);
router.post('/calcular-comision', transaccionController.calcularComisionCpp);

module.exports = router;