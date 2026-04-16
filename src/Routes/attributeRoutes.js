// // routes/attributeRoutes.js
// const express = require('express');
// const router = express.Router();
// const attributeController = require('../Controllers/attributeController');
// // const authentication = require('../Middleware/auth'); // Add middleware when ready

// router.get('/all-with-values', attributeController.getAllAttributesWithValues);
// router.post('/create', attributeController.createAttribute);
// router.post('/:attributeId/values/add', attributeController.addAttributeValue);

// module.exports = router;


const express = require('express');
const router = express.Router();
const attributeController = require('../Controllers/attributeController');
const { auth, can } = require('../Middleware/auth');

router.get('/all-with-values', auth, can('attributes:read'), attributeController.getAllAttributesWithValues);
router.post('/create', auth, can('attributes:create'), attributeController.createAttribute);
router.post('/:attributeId/values/add', auth, can('attributes:create'), attributeController.addAttributeValue);

// New Routes
router.put('/:attributeId', auth, can('attributes:update'), attributeController.updateAttribute);
router.put('/values/:valueId', auth, can('attributes:update'), attributeController.updateAttributeValue);
router.delete('/:attributeId', auth, can('attributes:delete'), attributeController.deleteAttribute);
router.delete('/values/:valueId', auth, can('attributes:delete'), attributeController.deleteAttributeValue);

module.exports = router;