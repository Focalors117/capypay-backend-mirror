const supabase = require('../config/supabase'); 
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_capypay_2026';

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

        // Generar Token JWT real
        const token = jwt.sign(
            { id: usuario.id, email: usuario.email }, 
            JWT_SECRET, 
            { expiresIn: '24h' }
        );

        res.status(200).json({
            mensaje: "Login exitoso",
            token: token,            // <--- Token real
            usuarioId: usuario.id,
            nombre: usuario.name,    
            cedula: usuario.cedula,  
            balance: usuario.balance 
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

// 3.5. ACTUALIZAR PIN
const actualizarPin = async (req, res) => {
    const { id } = req.params;
    const { pin } = req.body;

    if (!id || !pin) {
        return res.status(400).json({ error: "Faltan datos" });
    }

    if (!pin || (pin.length !== 4 && pin.length !== 6) || isNaN(pin)) {
         return res.status(400).json({ error: "El PIN debe ser de 4 o 6 números" });
    }

    try {
        const hashedPin = await bcrypt.hash(pin, 10);

        const { error } = await supabase
            .from('profiles')
            .update({ pin: hashedPin }) 
            .eq('id', id);

        if (error) {
            console.error("Error updating PIN:", error);
            // Si la columna no existe, esto fallará. 
            // Asegúrate de que tu compañero haya creado la columna 'pin' (text) en 'profiles'.
            return res.status(400).json({ error: error.message });
        }

        res.status(200).json({ mensaje: "PIN actualizado correctamente" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al actualizar PIN" });
    }
};

// 4. OBTENER CONTACTOS
const obtenerContactos = async (req, res) => {
    try {
        const { usuario_id } = req.query; // ?usuario_id=XXX

        if (!usuario_id) return res.status(400).json({ error: "Falta usuario_id" });

        console.log(`[CONTACTOS] Buscando contactos para usuario_id: ${usuario_id}`);

        const { data: contactos, error } = await supabase
            .from('contacts')
            .select(`
                id,
                alias,
                is_favorite,
                contact_id,
                contact_info:profiles!contact_id ( name, cedula )
            `)
            .eq('user_id', usuario_id);

        if (error) {
            console.error("Error obteniendo contactos (puede que la tabla no exista):", error.message);
            return res.status(200).json({ contactos: [] }); 
        }

        console.log(`[CONTACTOS] Encontrados: ${contactos?.length || 0}`);

        const lista = (contactos || []).map(c => ({
            id: c.id,
            nombre: c.alias || (c.contact_info ? c.contact_info.name : 'Desconocido'),
            cedula: (c.contact_info ? c.contact_info.cedula : ''),
            iniciales: (c.alias || (c.contact_info ? c.contact_info.name : 'Unknown')).substring(0, 2).toUpperCase(),
            is_favorite: c.is_favorite || false
        }));

        res.status(200).json({ contactos: lista });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno" });
    }
};

// 5. AGREGAR CONTACTO
const agregarContacto = async (req, res) => {
    try {
        const { usuario_id, cedula, alias } = req.body;

        if (!usuario_id || !cedula) {
            return res.status(400).json({ error: "Faltan datos (usuario_id, cedula)" });
        }

        // 1. Buscar al usuario destino por Cédula
        const { data: usuarioDestino, error: errorBusqueda } = await supabase
            .from('profiles')
            .select('id, name')
            .eq('cedula', cedula)
            .single();

        if (errorBusqueda || !usuarioDestino) {
            return res.status(404).json({ error: "No existe usuario con esa cédula" });
        }

        if (usuarioDestino.id === usuario_id) {
             return res.status(400).json({ error: "No puedes agregarte a ti mismo" });
        }

        // 2. Verificar si ya existe el contacto
        const { data: existente } = await supabase
            .from('contacts')
            .select('*')
            .eq('user_id', usuario_id)
            .eq('contact_id', usuarioDestino.id)
            .single();

        if (existente) {
            return res.status(400).json({ error: "Este usuario ya está en tus contactos" });
        }

        // 3. Insertar en tabla contacts
        const { error: errorInsert } = await supabase
            .from('contacts')
            .insert([
                {
                    user_id: usuario_id,
                    contact_id: usuarioDestino.id,
                    alias: alias || usuarioDestino.name // Si no pone alias, usamos su nombre real
                }
            ]);

        if (errorInsert) {
            console.error(errorInsert);
            return res.status(500).json({ error: "Error al agregar contacto" });
        }

        res.status(201).json({ mensaje: "Contacto agregado exitosamente" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// 6. ELIMINAR CONTACTO
const eliminarContacto = async (req, res) => {
    try {
        const { id } = req.params; // ID de la relación (tabla contacts)

        if (!id) return res.status(400).json({ error: "Falta ID del contacto" });

        const { error } = await supabase
            .from('contacts')
            .delete()
            .eq('id', id);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: "Error al eliminar contacto" });
        }

        res.status(200).json({ mensaje: "Contacto eliminado" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno" });
    }
};

// 7. BUSCAR USUARIOS (Para autocompletado)
const buscarUsuarios = async (req, res) => {
    try {
        const { q } = req.query; // ?q=123

        if (!q || q.length < 2) return res.status(200).json({ resultados: [] });

        // Buscamos usuarios cuya cédula comience con 'q'
        // 'textSearch' o 'ilike' depende de tu config, pero 'ilike' en columna texto funciona
        // Si cedula es número, hay que hacer cast. Asumimos que es varchar/text en DB o usamos eq si es match exacto
        // Para autocompletar 'like' con % es lo standard.
        // Supabase filter: .ilike('cedula', `${q}%`)
        
        const { data: usuarios, error } = await supabase
            .from('profiles')
            .select('id, name, cedula')
            .ilike('cedula', `${q}%`) 
            .limit(5);

        if (error) {
            console.error(error);
            return res.status(200).json({ resultados: [] });
        }

        res.status(200).json({ resultados: usuarios });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno" });
    }
};

// 8. TOGGLE FAVORITO
const toggleFavorito = async (req, res) => {
    try {
        const { id } = req.params; // ID de la tabla contacts
        const { is_favorite } = req.body;

        // Actualizar
        const { data, error } = await supabase
            .from('contacts')
            .update({ is_favorite: is_favorite })
            .eq('id', id)
            .select();

        if (error) {
            console.error("Error toggle favorito (¿Columna is_favorite existe?):", error.message);
            // Fallback silencioso si no existe la columna para no romper la app, o retornar error
            return res.status(400).json({ error: error.message });
        }

        res.status(200).json({ message: "Favorito actualizado", data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno" });
    }
};

module.exports = { 
    registrarUsuario, 
    loginUsuario, 
    verPerfil, 
    obtenerContactos, 
    agregarContacto, 
    eliminarContacto, 
    buscarUsuarios,
    toggleFavorito,
    actualizarPin
};
