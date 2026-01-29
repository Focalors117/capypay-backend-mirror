#include <iostream>
#include <cstdlib> // Necesario para usar atof o atoi

using namespace std;

int main(int argc, char* argv[]) {
    // Verificamos que nos hayan enviado el dato
    if (argc < 2) {
        cout << "Error: Falta el monto" << endl;
        return 1;
    }

    // Convertimos el argumento (texto) a numero
    // argv[1] es el número 500 que enviaste desde Node
    double monto = atof(argv[1]); 
    
    // --- AQUÍ PONES TU LÓGICA DE COMISIÓN ---
    double comision = monto * 0.05; // Ejemplo del 5%
    double total = monto + comision;

    // IMPORTANTE: Imprime SOLO el resultado final o un JSON
    // Evita imprimir "Ingrese monto" o textos de bienvenida
    cout << total; 
    
    return 0;
}