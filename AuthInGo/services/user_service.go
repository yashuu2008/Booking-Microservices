package services

import (
	env "AuthInGo/config/env"
	db "AuthInGo/db/repositories"
	"AuthInGo/dto"
	"AuthInGo/models"
	"AuthInGo/utils"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

type UserService interface {
	GetUserById(id string) (*models.User, error)
	CreateUser(payload *dto.CreateUserRequestDTO) (*models.User, error)
	LoginUser(payload *dto.LoginUserRequestDTO) (string, error)
}

type UserServiceImpl struct {
	userRepository db.UserRepository
	roleService    RoleService
}

func NewUserService(_userRepository db.UserRepository, _roleService RoleService) UserService {
	return &UserServiceImpl{
		userRepository: _userRepository,
		roleService:    _roleService,
	}
}

func (u *UserServiceImpl) GetUserById(id string) (*models.User, error) {
	fmt.Println("Fetching user in UserService")
	user, err := u.userRepository.GetByID(id)
	if err != nil {
		fmt.Println("Error fetching user:", err)
		return nil, err
	}
	return user, nil
}

func (u *UserServiceImpl) CreateUser(payload *dto.CreateUserRequestDTO) (*models.User, error) {
	fmt.Println("Creating user in UserService")

	// Step 1. Hash the password using utils.HashPassword
	hashedPassword, err := utils.HashPassword(payload.Password)
	if err != nil {
		fmt.Println("Error hashing password:", err)
		return nil, err
	}

	// Step 2. Call the repository to create the user
	user, err := u.userRepository.Create(payload.Username, payload.Email, hashedPassword)
	if err != nil {
		fmt.Println("Error creating user:", err)
		return nil, err
	}

	// Step 3. Automatically assign default "user" role (roleId: 2) to new user
	var defaultUserRoleId int64 = 2
	err = u.roleService.AssignRoleToUser(user.Id, defaultUserRoleId)
	if err != nil {
		fmt.Printf("Warning: Failed to assign default role to user %d: %v\n", user.Id, err)
	}

	// Step 4. Return the created user
	return user, nil
}

func (u *UserServiceImpl) LoginUser(payload *dto.LoginUserRequestDTO) (string, error) {
	email := payload.Email
	password := payload.Password

	// Step 1. Make a repository call to get the user by email
	user, err := u.userRepository.GetByEmail(email)
	if err != nil {
		fmt.Println("Error fetching user by email:", err)
		return "", err
	}

	// Step 2. If user exists, or not. If not exists, return error
	if user == nil {
		fmt.Println("No user found with the given email")
		return "", fmt.Errorf("no user found with email: %s", email)
	}

	// Step 3. Check the password using utils.CheckPasswordHash
	isPasswordValid := utils.CheckPasswordHash(password, user.Password)
	if !isPasswordValid {
		fmt.Println("Password does not match")
		return "", fmt.Errorf("invalid email or password")
	}

	// Step 4. Sign JWT token
	jwtPayload := jwt.MapClaims{
		"email": user.Email,
		"id":    user.Id,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwtPayload)
	tokenString, err := token.SignedString([]byte(env.GetString("JWT_SECRET", "TOKEN")))
	if err != nil {
		fmt.Println("Error signing token:", err)
		return "", err
	}

	fmt.Println("JWT Token generated successfully")
	return tokenString, nil
}
