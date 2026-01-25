const express = require('express');

const router = express.Router();

const transaccionController = require('../controllers/transaccion.controller');

//routes
router.post('/recargar', transaccionController.recargarSaldo);
router.post('/transferir', transaccionController.transferirSaldo);

router.get('/historial', transaccionController.obtenerHistorial);

router.post('/config-tasa', transaccionController.configurarTasa);
router.get('/tasa', transaccionController.obtenerTasa);

module.exports = router;