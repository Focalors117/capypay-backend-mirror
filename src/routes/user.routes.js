const express = require('express');
const router = express.Router();


//importamos el controlador que acabamos de crear
const userController = require('../controllers/user.controller');


//definimos la ruta para registrar un nuevo usuario
// POST /api/users/register
// cuando alguien llame a esta url, ejecuta la funcion registrarUsuario del userController
router.post('/registro', userController.registrarUsuario);
router.post('/login', userController.loginUsuario);

module.exports = router; // Exporta el router para que pueda ser utilizado en la aplicación principal