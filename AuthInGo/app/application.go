package app

import (
	"AuthInGo/clients"
	dbConfig "AuthInGo/config/db"
	config "AuthInGo/config/env"
	"AuthInGo/controllers"
	repo "AuthInGo/db/repositories"
	"AuthInGo/router"
	"AuthInGo/services"
	"fmt"
	"net/http"
	"time"
)

// Config holds the configuration for the server.
type Config struct {
	Addr string // PORT
}

type Application struct {
	Config Config
}

// Constructor for Config
func NewConfig() Config {

	port := config.GetString("PORT", ":8080")

	return Config{
		Addr: port,
	}
}

// Constructor for Application
func NewApplication(cfg Config) *Application {
	return &Application{
		Config: cfg,
	}
}

func (app *Application) Run() error {

	db, err := dbConfig.SetupDB()

	if err != nil {
		fmt.Println("Error setting up database:", err)
		return err
	}

	ur := repo.NewUserRepository(db)
	rr := repo.NewRoleRepository(db)
	rpr := repo.NewRolePermissionRepository(db)
	urr := repo.NewUserRoleRepository(db)
	otpr := repo.NewOTPRepository(db)

	notificationBaseURL := config.GetString("NOTIFICATION_SERVICE_URL", "http://localhost:3002")
	nc := clients.NewNotificationClient(notificationBaseURL)

	rs := services.NewRoleService(rr, rpr, urr)
	us := services.NewUserService(ur, rs)
	otps := services.NewOTPService(otpr, nc)

	uc := controllers.NewUserController(us)
	rc := controllers.NewRoleController(rs)
	otpc := controllers.NewOTPController(otps)

	uRouter := router.NewUserRouter(uc)
	rRouter := router.NewRoleRouter(rc)
	otpRouter := router.NewOTPRouter(otpc)

	server := &http.Server{
		Addr:         app.Config.Addr,
		Handler:      router.SetupRouter(uRouter, rRouter, otpRouter),
		ReadTimeout:  10 * time.Second, // Set read timeout to 10 seconds
		WriteTimeout: 10 * time.Second, // Set write timeout to 10 seconds
	}

	fmt.Println("Starting server on", app.Config.Addr)

	return server.ListenAndServe()
}
