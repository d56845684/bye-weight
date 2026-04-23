-- 開發環境：只建立空資料庫，schema 由各服務的 migration 管理
SELECT 'CREATE DATABASE auth_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec
SELECT 'CREATE DATABASE app_db'  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'app_db')\gexec
SELECT 'CREATE DATABASE kuji_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kuji_db')\gexec
