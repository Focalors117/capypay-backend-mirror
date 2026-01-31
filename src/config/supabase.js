const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Lee el archivo .env en src/

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Si faltan las llaves mostramos un error
if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Error: Faltan las llaves en el archivo .env");
}

// Creamos la conexión
const supabase = createClient(supabaseUrl, supabaseKey);

console.log("✅ Cliente de Supabase inicializado correctamente");

module.exports = supabase;