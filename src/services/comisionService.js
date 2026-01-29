const { execFile } = require('child_process');
const path = require('path');

const calcularComisionCpp = (monto, tipoUsuario) => {
    return new Promise((resolve, reject) => {
        // __dirname es la carpeta actual (src/services).
        // Necesitamos subir dos niveles para llegar a la raíz (capypay-backend)
        const nombreEjecutable = process.platform === 'win32' ? 'calcular_comision.exe' : 'calcular_comision';
        const ruta = path.join(__dirname, '..', '..', nombreEjecutable);

        // Convertimos monto a string porque C++ recibe puro texto en los argumentos
        const args = [String(monto), tipoUsuario];

        execFile(ruta, args, (error, stdout) => {
            if (error) {
                // Si C++ falla, cobramos 0 de comisión para no trancar la transferencia
                console.error("Error ejecutando C++:", error);
                resolve(0); 
                return;
            }
            // Limpiamos el texto (trim) y lo convertimos a número
            resolve(parseFloat(stdout.trim()));
        });
    });
};

module.exports = { calcularComisionCpp };