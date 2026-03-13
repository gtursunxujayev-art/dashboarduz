// Test script to verify environment validation
const originalEnv = { ...process.env };

// Test 1: No DATABASE_URL, no individual components
console.log('Test 1: No DATABASE_URL, no individual components');
delete process.env.DATABASE_URL;
delete process.env.DB_HOST;
delete process.env.DB_NAME;
delete process.env.DB_USERNAME;
delete process.env.DB_PASSWORD;

try {
  const { validateAllFeatures } = require('./dist/config/env-validator');
  validateAllFeatures();
  console.log('✓ Test 1 passed: Validation succeeded with missing DATABASE_URL\n');
} catch (error) {
  console.log('✗ Test 1 failed:', error.message, '\n');
}

// Test 2: Invalid DATABASE_URL format
console.log('Test 2: Invalid DATABASE_URL format');
process.env.DATABASE_URL = 'invalid-url';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-to-pass-validation';

try {
  const { validateAllFeatures } = require('./dist/config/env-validator');
  validateAllFeatures();
  console.log('✓ Test 2 passed: Validation succeeded with invalid DATABASE_URL format\n');
} catch (error) {
  console.log('✗ Test 2 failed:', error.message, '\n');
}

// Test 3: Valid DATABASE_URL
console.log('Test 3: Valid DATABASE_URL');
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

try {
  const { validateAllFeatures } = require('./dist/config/env-validator');
  validateAllFeatures();
  console.log('✓ Test 3 passed: Validation succeeded with valid DATABASE_URL\n');
} catch (error) {
  console.log('✗ Test 3 failed:', error.message, '\n');
}

// Test 4: Individual components (should construct DATABASE_URL)
console.log('Test 4: Individual components');
delete process.env.DATABASE_URL;
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'testdb';
process.env.DB_USERNAME = 'testuser';
process.env.DB_PASSWORD = 'testpass';

try {
  const { validateAllFeatures } = require('./dist/config/env-validator');
  validateAllFeatures();
  console.log('✓ Test 4 passed: Validation succeeded with individual components\n');
} catch (error) {
  console.log('✗ Test 4 failed:', error.message, '\n');
}

// Test 5: SKIP_ENV_VALIDATION=true
console.log('Test 5: SKIP_ENV_VALIDATION=true');
process.env.SKIP_ENV_VALIDATION = 'true';
delete process.env.JWT_SECRET; // Remove required var to test skip

try {
  const { validateAllFeatures } = require('./dist/config/env-validator');
  validateAllFeatures();
  console.log('✓ Test 5 passed: Validation skipped with SKIP_ENV_VALIDATION=true\n');
} catch (error) {
  console.log('✗ Test 5 failed:', error.message, '\n');
}

// Restore original environment
process.env = originalEnv;
console.log('All tests completed!');