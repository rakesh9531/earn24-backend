// File: /config/permissions.js

const ROLES = {
    ADMIN: 'admin',
    MANAGER: 'manager',
    STAFF: 'staff',
    MERCHANT: 'Merchant',
    RETAILER: 'Retailer'
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
        'categories:read',
        'subcategories:read',
        'brands:read',
        'hsn:read',
        'attributes:read'
    ],
    [ROLES.STAFF]: [
        'orders:read',
        'orders:updateStatus',
        'inventory:read',
        'products:read',
        'categories:read',
        'subcategories:read',
        'brands:read',
        'hsn:read',
        'attributes:read'
    ],
    'Merchant': [
        'inventory:read:own', 
        'inventory:create:own',
        'inventory:update:own',
        'orders:read:own',
        'categories:read',
        'subcategories:read',
        'brands:read',
        'hsn:read',
        'attributes:read',
        'products:read'
    ],
    'merchant': [
        'inventory:read:own', 
        'inventory:create:own',
        'inventory:update:own',
        'orders:read:own',
        'categories:read',
        'subcategories:read',
        'brands:read',
        'hsn:read',
        'attributes:read',
        'products:read'
    ],
    'Retailer': [
        'inventory:read:own', 
        'inventory:create:own',
        'inventory:update:own',
        'orders:read:own',
        'categories:read',
        'subcategories:read',
        'brands:read',
        'hsn:read',
        'attributes:read',
        'products:read'
    ],
    'retailer': [
        'inventory:read:own', 
        'inventory:create:own',
        'inventory:update:own',
        'orders:read:own',
        'categories:read',
        'subcategories:read',
        'brands:read',
        'hsn:read',
        'attributes:read',
        'products:read'
    ]
};

module.exports = {
    ROLES,
    permissions
};