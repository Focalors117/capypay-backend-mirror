const bcrypt = require('bcryptjs'); 
// const usersDB = []; ...

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

    const passwordEncriptada = bcrypt.hashSync(password, 10); // Encriptar la contraseña

    const nuevoUsuario = {
        id: userDB.length + 1, // Generar un nuevo ID basado en la longitud del array (incremental)
        nombre : nombre,
        email : email,
        password : passwordEncriptada,
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
    const passwordEsCorrecta = bcrypt.compareSync(password, usuarioEncontrado.password);

    if (!passwordEsCorrecta) { // <--- Usamos el resultado de arriba
        return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    // 5. Respuesta Final (SOLO UNA)
    // Si llegamos aquí, todo está bien.
    res.status(200).json({
        mensaje: "¡Bienvenido de nuevo!",
        token: "token_falso_123", // Simulamos un token
        datos: {
            nombre: usuarioEncontrado.nombre,
            saldo: usuarioEncontrado.saldo
        }
    });

};

    //-----------------------------------------
    // GET (ver perfil de usuario)
    //-----------------------------------------

// ... (Aquí arriba están tus funciones de registrarUsuario y loginUsuario)

// 3. NUEVA FUNCIÓN: Ver Perfil
const verPerfil = (req, res) => {
    // Capturamos el ID de la URL y lo convertimos a número
    const id = parseInt(req.params.id);

    // Buscamos en el array
    const usuarioEncontrado = userDB.find(user => user.id === id);

    // Si no existe, devolvemos error 404
    if (!usuarioEncontrado) {
        return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // Si existe, devolvemos los datos (SIN el password)
    res.status(200).json({
        mensaje: "Perfil encontrado",
        datos: {
            id: usuarioEncontrado.id,
            nombre: usuarioEncontrado.nombre,
            email: usuarioEncontrado.email,
            saldo: usuarioEncontrado.saldo
        }
    });
};

// ⚠️ IMPORTANTE: Exportar las 3 funciones
module.exports = { 
    registrarUsuario, 
    loginUsuario, 
    verPerfil 
}; // Exporta la función para que pueda ser utilizada en las rutas de la aplicación
