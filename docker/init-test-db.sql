-- Create the test database if it doesn't already exist.
-- This script runs automatically when the PostgreSQL container starts for the first time.
SELECT 'CREATE DATABASE infrawatch_test OWNER infrawatch'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'infrawatch_test')\gexec
