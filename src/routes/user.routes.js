const express = require('express');
const router = express.Router();


//importamos el controlador que acabamos de crear
const userController = require('../controllers/user.controller');


//definimos la ruta para registrar un nuevo usuario
// POST /api/users/register
// cuando alguien llame a esta url, ejecuta la funcion registrarUsuario del userController
router.post('/registro', userController.registrarUsuario);
// http://localhost:3000/api/registro

router.post('/login', userController.loginUsuario);
// http://localhost:3000/api/login

// los dos puntos (:) indican que es un parametro dinamico, y q expres no lo tome literalmente como "id"
router.get('/usuario/:id', userController.verPerfil); //por que get? porque solo queremos ver datos, no modificarlos ni crearlos
// http://localhost:3000/api/usuario/1
module.exports = router; // Exporta el router para que pueda ser utilizado en la aplicación principal