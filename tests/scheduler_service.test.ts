import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { RebrandDatabase } from "../src/database";
import fs from "fs";
import path from "path";

describe("Scheduler logic", () => {
  const testDbPath = path.resolve(process.cwd(), "data", "test_scheduler.sqlite");
  let db: RebrandDatabase;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    db = new RebrandDatabase(testDbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("schedules consecutive weekends when multiple proposals are approved", () => {
    const p1 = db.createProposal({
      guildId: "guild-test",
      userId: "user-1",
      name: "Weekend 1",
      iconUrl: "https://example.com/icon1.png",
    });

    const p2 = db.createProposal({
      guildId: "guild-test",
      userId: "user-2",
      name: "Weekend 2",
      iconUrl: "https://example.com/icon2.png",
    });

    const p3 = db.createProposal({
      guildId: "guild-test",
      userId: "user-3",
      name: "Weekend 3",
      iconUrl: "https://example.com/icon3.png",
    });

    const app1 = db.approveProposal(p1.id, "owner");
    const app2 = db.approveProposal(p2.id, "owner");
    const app3 = db.approveProposal(p3.id, "owner");

    expect(app1?.scheduled_date).toBeDefined();
    expect(app2?.scheduled_date).toBeDefined();
    expect(app3?.scheduled_date).toBeDefined();

    expect(app1?.scheduled_date !== app2?.scheduled_date).toBe(true);
    expect(app2?.scheduled_date !== app3?.scheduled_date).toBe(true);

    const schedule = db.getUpcomingSchedule("guild-test");
    expect(schedule.length).toBe(3);
    expect(schedule[0]?.id).toBe(p1.id);
    expect(schedule[1]?.id).toBe(p2.id);
    expect(schedule[2]?.id).toBe(p3.id);
  });

  it("handles cancel proposal", () => {
    const p = db.createProposal({
      guildId: "guild-test",
      userId: "user-1",
      name: "Cancelled Rebrand",
      iconUrl: "https://example.com/icon.png",
    });

    db.approveProposal(p.id, "owner");
    expect(db.getUpcomingSchedule("guild-test").length).toBe(1);

    db.cancelProposal(p.id);
    expect(db.getUpcomingSchedule("guild-test").length).toBe(0);
    expect(db.getProposal(p.id)?.status).toBe("cancelled");
  });
});
