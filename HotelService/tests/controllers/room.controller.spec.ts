import express from "express";
import request from "supertest";
import { StatusCodes } from "http-status-codes";
import * as roomService from "../../src/services/room.service";
import router from "../../src/routers/v1/index.router";

jest.mock("../../src/services/room.service");

describe("Room Controller", () => {
  const app = express().use(express.json()).use("/api/v1", router);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/v1/rooms/available", () => {
    it("should return 200 with available rooms", async () => {
      const mockRooms = [
        { id: 1, roomCategoryId: 1, isAvailable: true },
        { id: 2, roomCategoryId: 1, isAvailable: true },
      ];

      (roomService.getAvailableRoomsService as jest.Mock).mockResolvedValue(mockRooms);

      const res = await request(app)
        .get("/api/v1/rooms/available")
        .query({
          roomCategoryId: "1",
          checkInDate: "2026-12-01",
          checkOutDate: "2026-12-05",
        });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body).toEqual({
        success: true,
        message: "Available rooms fetched successfully",
        data: mockRooms,
      });
      expect(roomService.getAvailableRoomsService).toHaveBeenCalledWith({
        roomCategoryId: 1,
        checkInDate: new Date("2026-12-01"),
        checkOutDate: new Date("2026-12-05"),
      });
    });

    it("should return empty array when no rooms are available", async () => {
      (roomService.getAvailableRoomsService as jest.Mock).mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/rooms/available")
        .query({
          roomCategoryId: "2",
          checkInDate: "2026-12-24",
          checkOutDate: "2026-12-26",
        });

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body).toEqual({
        success: true,
        message: "Available rooms fetched successfully",
        data: [],
      });
    });
  });

  describe("POST /api/v1/rooms/update-booking-id", () => {
    it("should return 200 when booking ID is updated successfully", async () => {
      const requestBody = {
        bookingId: 101,
        roomIds: [1, 2, 3],
      };

      const mockResult = [3]; // 3 rows updated
      (roomService.updateBookingIdToRoomsService as jest.Mock).mockResolvedValue(mockResult);

      const res = await request(app)
        .post("/api/v1/rooms/update-booking-id")
        .send(requestBody);

      expect(res.status).toBe(StatusCodes.OK);
      expect(res.body).toEqual({
        success: true,
        message: "Booking ID updated to rooms successfully",
        data: mockResult,
      });
      expect(roomService.updateBookingIdToRoomsService).toHaveBeenCalledWith(requestBody);
    });
  });
});
