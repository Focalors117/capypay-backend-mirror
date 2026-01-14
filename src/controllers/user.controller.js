const userDB = require('../models/user.model'); // Importación del modelo de usuario

// funcion para registrar un nuevo usuario (conectado a routes)
//req: datos que envia el cliente
//res: respuesta que envia el servidor
const registrarUsuario = (req, res) => {
    
    //sacamos los datos del json que nos envian
    const { nombre, email, password} = req.body;

    //validamos
    // si falta algun dato obligatorio, respondemos con un error 400
    if (!nombre || !email || !password) {
        return res.status(400).json({
            error: "Faltan datos obligatorios",
            mensaje : "Debes proporcionar nombre, email y contraseña"
        });
    }

    const existe = userDB.find(user => user.email === email);
    if (existe) {
        return res.status(409).json({error : "El email ya está registrado"});
    }

    const nuevoUsuario = {
        id: userDB.length + 1, // Generar un nuevo ID basado en la longitud del array (incremental)
        nombre : nombre,
        email : email,
        password : password,
        saldo : 0.00 // Saldo inicial
    }        

    userDB.push(nuevoUsuario); // Agregar el nuevo usuario al array de usuarios

    res.status(201).json({
        mensaje: "Usuario registrado exitosamente",
        datos: {
            id: nuevoUsuario.id,
            nombre: nuevoUsuario.nombre,
            email: nuevoUsuario.email,
            saldo: nuevoUsuario.saldo
        }
    });

};


//----- funcion para LOGIN de usuario ----------
const loginUsuario = (req, res) => {
    const { email, password } = req.body;

    //validacion
    const usuarioEncontrado = userDB.find(user => user.email === email);

    // Cuando el usuario no existe
    if (!usuarioEncontrado) {
        return res.status(404).json({error : "Usuario no encontrado"});
    }

    // Cuando faltan datos obligatorios
    if (!email || !password) {
        return res.status(400).json({
            error: "Faltan datos obligatorios",
            mensaje : "Debes proporcionar email y contraseña"
        });
    }

    // Cuando la contraseña es incorrecta
    if (usuarioEncontrado.password !== password) {
        return res.status(401).json({error : "Contraseña incorrecta"});
    }

    // Si todo está bien, respondemos con los datos del usuario (imprimiendo lo necesario)
    res.status(201).json({
        mensaje: "Login exitoso!",
        datos: {
            nombre: usuarioEncontrado.nombre,
            saldo: usuarioEncontrado.saldo
        }
    });
    
};

module.exports = { registrarUsuario, loginUsuario }; // Exporta la función para que pueda ser utilizada en las rutas de la aplicación

    