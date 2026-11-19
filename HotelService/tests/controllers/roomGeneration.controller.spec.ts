import express from "express";
import request from "supertest";
import { StatusCodes } from "http-status-codes";
import router from "../../src/routers/v1/index.router";
import * as roomGenerationProducer from "../../src/producers/roomGeneration.producer";

jest.mock("../../src/producers/roomGeneration.producer");

describe("Room Generation Controller", () => {
  const app = express().use(express.json()).use("/api/v1", router);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/v1/room-generation", () => {
    it("should return 201 when job is queued successfully", async () => {
      (roomGenerationProducer.addRoomGenerationJobToQueue as jest.Mock).mockResolvedValue(undefined);

      const body = {
        roomCategoryId: 1,
        startDate: new Date("2026-12-01T00:00:00.000Z").toISOString(),
        endDate: new Date("2026-12-10T00:00:00.000Z").toISOString(),
        scheduleType: "immediate",
        priceOverride: 150,
      };

      const res = await request(app)
        .post("/api/v1/room-generation")
        .send(body);

      expect(res.status).toBe(StatusCodes.CREATED);
      expect(res.body).toEqual({
        message: "Room generation job added to queue successfully",
        success: true,
        data: {},
      });
      expect(roomGenerationProducer.addRoomGenerationJobToQueue).toHaveBeenCalledWith(body);
    });

    it("should validate request body and return 400 for invalid payload", async () => {
      const res = await request(app)
        .post("/api/v1/room-generation")
        .send({
          roomCategoryId: "not-a-number",
          startDate: "invalid-date",
        });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(roomGenerationProducer.addRoomGenerationJobToQueue).not.toHaveBeenCalled();
    });
  });
});
