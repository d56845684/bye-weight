package main

import (
	"errors"
	"log"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

// RunMigrations 在服務啟動前自動執行 DB migration
func RunMigrations(databaseURL, migrationsPath string) error {
	m, err := migrate.New(
		"file://"+migrationsPath,
		databaseURL,
	)
	if err != nil {
		return err
	}
	defer m.Close()

	err = m.Up()
	if err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}

	version, dirty, _ := m.Version()
	if dirty {
		log.Printf("WARNING: migration state is dirty at version %d", version)
	} else {
		log.Printf("auth_db migration: version %d (up to date)", version)
	}
	return nil
}
