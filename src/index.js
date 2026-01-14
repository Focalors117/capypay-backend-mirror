const express = require('express');
const app = express(); // Crear una instancia de la aplicación Express
const PORT = 3000;

const userRoutes = require('./routes/user.routes'); // Importar las rutas de usuario

app.use(express.json()); // Middleware para parsear JSON en las solicitudes


//configuramos las rutas
//todas las rutas que definamos en userRoutes van a empezar con /api
// Ejemplo: http://localhost:3000/api/registro
app.use('/api', userRoutes);

//ruta de prueba para ver si el servidor vive/enciende

app.get('/', (req, res) => {
    res.send('<h1>backend inicializado correctamente!<h1>');
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
    console.log(`Ruta de registro lista en: http://localhost:${PORT}/api/registro`);
});