// File: /config/permissions.js

const ROLES = {
    ADMIN: 'admin',
    MANAGER: 'manager',
    STAFF: 'staff'
};

const permissions = {
    [ROLES.ADMIN]: [
        '*' // The admin can do everything
    ],
    [ROLES.MANAGER]: [
        'users:read',
        'products:read',
        'products:update',
        'inventory:read',
        'inventory:create',
        'inventory:update',
        'orders:read',
        'orders:updateStatus',
        'reports:read',
        'deliveryAgent:read',
    ],
    [ROLES.STAFF]: [
        'orders:read',
        'orders:updateStatus',
        'inventory:read',
        'products:read'
    ],

     [ROLES.MERCHANT]: [
        'inventory:read:own', 
        'inventory:create:own',
        'inventory:update:own',
        'orders:read:own',
        'categories:read',
        'subcategories:read',
        'brands:read',
        'hsn:read',
        'products:read'
    ],


     [ROLES.RETAILER]: [
        'inventory:read:own', 
        'inventory:create:own',
        'inventory:update:own',
        'orders:read:own',
        'categories:read',
        'subcategories:read',
        'brands:read',
        'hsn:read',
        'products:read'
    ]
};

module.exports = {
    ROLES,
    permissions
};