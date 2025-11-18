// const express = require('express');
// const router = express.Router();
// const deliveryAgentController = require('../Controllers/deliveryAgentController');
// // const { authMiddleware, isAdmin } = require('../middleware/authMiddleware');

// // For a real app, all these routes should be protected and only accessible by an Admin.
// // router.use(authMiddleware, isAdmin);

// // GET /api/admin/delivery-agents/ - Get all delivery agents (for management page)
// router.get('/', deliveryAgentController.getAllAgents);

// // POST /api/admin/delivery-agents/create - Create a new delivery agent
// router.post('/create', deliveryAgentController.createAgent);

// // PUT /api/admin/delivery-agents/update/:agentId - Update an agent's details
// router.put('/update/:agentId', deliveryAgentController.updateAgent);

// // PATCH /api/admin/delivery-agents/toggle-status/:agentId - Quickly activate/deactivate an agent
// router.patch('/toggle-status/:agentId', deliveryAgentController.toggleAgentStatus);

// // DELETE /api/admin/delivery-agents/delete/:agentId - Delete an agent
// router.delete('/delete/:agentId', deliveryAgentController.deleteAgent);

// module.exports = router;







const express = require('express');
const router = express.Router();
const deliveryAgentController = require('../Controllers/deliveryAgentController');
const { auth, can } = require('../Middleware/auth');

// ==========================================================
// === THE FIX IS HERE ===
// ==========================================================
// REMOVED the blanket router.use() middleware.
// Instead, we will apply `auth` to each route individually.
// ==========================================================

// A manager or admin can READ the list of agents.
router.get('/', auth, can('deliveryAgent:read'), deliveryAgentController.getAllAgents);

// Only an ADMIN (or a role with 'deliveryAgent:manage') can CREATE, UPDATE, or DELETE agents.
router.post('/create', auth, can('deliveryAgent:manage'), deliveryAgentController.createAgent);
router.put('/update/:agentId', auth, can('deliveryAgent:manage'), deliveryAgentController.updateAgent);
router.patch('/toggle-status/:agentId', auth, can('deliveryAgent:manage'), deliveryAgentController.toggleAgentStatus);
router.delete('/delete/:agentId', auth, can('deliveryAgent:manage'), deliveryAgentController.deleteAgent);

module.exports = router;