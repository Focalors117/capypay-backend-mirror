const express = require('express');
const router = express.Router();
const comedorController = require('../controllers/comedor.controller');

router.get('/menu', comedorController.getMenu);
router.get('/stats', comedorController.getStats);
router.post('/order', comedorController.createOrder); // Requires { user_id, items }
router.post('/complete-all', comedorController.completeAllOrders); // DEV ENDPOINT
router.get('/order/:id', comedorController.getOrder);
router.get('/my-orders/:userId', comedorController.getUserOrders);

module.exports = router;
