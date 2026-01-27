const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');

router.get('/notifications/:userId', notificationController.getNotifications);
router.patch('/notifications/:id/read', notificationController.markAsRead);

module.exports = router;
