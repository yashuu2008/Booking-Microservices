package router

import (
	config "AuthInGo/config/env"
	"AuthInGo/controllers"
	"AuthInGo/utils"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Router interface {
	Register(r chi.Router)
}

func SetupRouter(UserRouter Router, RoleRouter Router, OTPRouter Router) *chi.Mux {

	chiRouter := chi.NewRouter()

	// chiRouter.Use(middlewares.RequestLogger) // Middleware for logging requests
	chiRouter.Use(middleware.Logger) // Built-in Chi middleware for logging requests

	// chiRouter.Use(middlewares.RateLimitMiddleware)

	chiRouter.Get("/ping", controllers.PingHandler)

	// Reverse proxy routes for downstream microservices
	hotelServiceURL := config.GetString("HOTEL_SERVICE_URL", "http://localhost:3000")
	bookingServiceURL := config.GetString("BOOKING_SERVICE_URL", "http://localhost:3001")

	chiRouter.HandleFunc("/hotelservice/*", utils.ProxyToService(hotelServiceURL, "/hotelservice"))
	chiRouter.HandleFunc("/bookingservice/*", utils.ProxyToService(bookingServiceURL, "/bookingservice"))

	UserRouter.Register(chiRouter)
	RoleRouter.Register(chiRouter)
	if OTPRouter != nil {
		OTPRouter.Register(chiRouter)
	}

	return chiRouter

}
