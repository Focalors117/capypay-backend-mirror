Los cambios realizados en el backend son los siguientes (v1):

Los controladores (transaccion.controller.js) cambie varias cosas alli para lograr integrarlo con el FrontEnd.

- *Recargas (recargarSaldo):*
- *Correcion de duplicados:* desactive (esta comentado) la actualizacion manual del balance (supabase.from('profiles').update...)
porque como supuse se iba a duplicar con el trigger que esta en la DB (porfavor indica si se puede usar un doble check como habiamos comentado,
si debo ajustar en la DB o aqui en el backend, no le di muchas vueltas para poder hacer funcionar las cosas rapido.

- *Nueva funcion "obtenerTasa": se creo para exponer publicamente la tasa del dolar actual a la app, permitiendo que la calculadora de recargas muestre datos reales.
- Inclui algunos logs en consola para poder ver los errores / respuesta del backend