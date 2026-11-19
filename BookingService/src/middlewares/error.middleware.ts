import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/errors/app.error";
import logger from "../config/logger.config";

export const appErrorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof AppError) {
        logger.warn(`AppError [${err.statusCode}]: ${err.message}`);
        return res.status(err.statusCode).json({
            success: false,
            message: err.message
        });
    }

    return next(err);
};

export const genericErrorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error(`Unhandled Error: ${err.message}`, { stack: err.stack });

    res.status(500).json({
        success: false,
        message: "Internal Server Error"
    });
};