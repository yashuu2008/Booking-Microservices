package config

import (
	env "AuthInGo/config/env"
	"database/sql"
	"fmt"
	"sync"

	"github.com/go-sql-driver/mysql"
)

var (
	dbInstance *sql.DB
	dbOnce     sync.Once
	dbErr      error
)

func SetupDB() (*sql.DB, error) {
	dbOnce.Do(func() {
		cfg := mysql.NewConfig()

		cfg.User = env.GetString("DB_USER", "root")
		cfg.Passwd = env.GetString("DB_PASSWORD", "root")
		cfg.Net = env.GetString("DB_NET", "tcp")
		cfg.Addr = env.GetString("DB_ADDR", "127.0.0.1:3306")
		cfg.DBName = env.GetString("DBName", "auth_dev")

		fmt.Println("Connecting to database:", cfg.DBName, cfg.FormatDSN())

		db, err := sql.Open("mysql", cfg.FormatDSN())
		if err != nil {
			fmt.Println("Error connecting to database:", err)
			dbErr = err
			return
		}

		fmt.Println("Trying to ping database...")
		pingErr := db.Ping()
		if pingErr != nil {
			fmt.Println("Error pinging database:", pingErr)
			dbErr = pingErr
			return
		}

		// Configure connection pool
		db.SetMaxOpenConns(25)
		db.SetMaxIdleConns(10)

		fmt.Println("Connected to database successfully:", cfg.DBName)
		dbInstance = db
	})

	if dbErr != nil {
		return nil, dbErr
	}

	return dbInstance, nil
}
