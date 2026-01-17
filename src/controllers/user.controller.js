const supabase = require('../config/supabase'); 
const bcrypt = require('bcryptjs'); 

// 1. REGISTRAR USUARIO (Adaptado a la FOTO de tu DB)
const registrarUsuario = async (req, res) => {
    try {
        // Ahora pedimos Cédula y Tipo (Cliente/Chofer) porque tu DB los pide
        const { nombre, email, password, cedula, tipo } = req.body; 

        if (!nombre || !email || !password || !cedula || !tipo) {
            return res.status(400).json({ error: "Faltan datos (nombre, email, password, cedula, tipo)" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // AQUÍ ESTÁ LA MAGIA: Usamos los nombres exactos de la foto
        const { data, error } = await supabase
            .from('profiles')
            .insert([
                { 
                    name: nombre,          // En la DB se llama 'name'
                    email: email,          // En la DB se llama 'email'
                    cedula: cedula,        // En la DB se llama 'cedula'
                    user_type: tipo,       // En la DB se llama 'user_type'
                    balance: 0,            // En la DB se llama 'balance'
                    // OJO: Dile a tu compa que agregue esta columna 'password' a la tabla
                    password: hashedPassword 
                }
            ])
            .select();

        if (error) {
            console.error("Error Supabase:", error);
            return res.status(400).json({ error: error.message });
        }

        res.status(201).json({
            mensaje: "Usuario registrado EXITOSAMENTE",
            usuario: data[0]
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// 2. LOGIN USUARIO (Adaptado a la FOTO)
const loginUsuario = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) return res.status(400).json({ error: "Faltan datos" });

        const { data: usuario, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !usuario) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        // Verificamos contraseña
        const coinciden = await bcrypt.compare(password, usuario.password);

        if (!coinciden) {
            return res.status(401).json({ error: "Contraseña incorrecta" });
        }

        res.status(200).json({
            mensaje: "Login exitoso",
            usuarioId: usuario.id,
            nombre: usuario.name,    // Ojo: ahora es usuario.name
            cedula: usuario.cedula,  // Devolvemos la cédula también
            balance: usuario.balance // Ojo: ahora es usuario.balance
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// 3. VER PERFIL (Adaptado a la FOTO)
const verPerfil = async (req, res) => {
    try {
        const { id } = req.params;

        const { data: usuario, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !usuario) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        res.status(200).json({
            nombre: usuario.name,
            email: usuario.email,
            cedula: usuario.cedula,
            tipo: usuario.user_type,
            balance: usuario.balance
        });

    } catch (err) {
        res.status(500).json({ error: "Error interno" });
    }
};

module.exports = { registrarUsuario, loginUsuario, verPerfil };