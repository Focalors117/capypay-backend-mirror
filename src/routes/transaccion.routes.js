const express = require('express');

const router = express.Router();

const transaccionController = require('../controllers/transaccion.controller');

//routes
router.post('/recargar', transaccionController.recargarSaldo);
router.post('/transferir', transaccionController.transferirSaldo);

module.exports = router;