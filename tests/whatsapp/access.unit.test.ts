import {
  canUseCommand,
  isAdmin,
  isCommandGroup,
  isAnnouncementGroup,
} from "../../src/whatsapp/access";
import { makeConfig } from "../_helpers";

const ADMIN_JID = "6281234567890@s.whatsapp.net";
const NON_ADMIN_JID = "6289999999999@s.whatsapp.net";
const COMMAND_GROUP = "group-cmd@g.us";
const ANNOUNCEMENT_GROUP = "group-announce@g.us";
const OTHER_GROUP = "group-other@g.us";
const PRIVATE_CHAT = "6281111111111@s.whatsapp.net";

describe("isAdmin", () => {
  it("returns true for admin JID", () => {
    const config = makeConfig({ admins: [ADMIN_JID] });
    expect(isAdmin(ADMIN_JID, config)).toBe(true);
  });

  it("returns false for non-admin JID", () => {
    const config = makeConfig({ admins: [ADMIN_JID] });
    expect(isAdmin(NON_ADMIN_JID, config)).toBe(false);
  });

  it("returns false when admins list is empty", () => {
    const config = makeConfig({ admins: [] });
    expect(isAdmin(ADMIN_JID, config)).toBe(false);
  });

  it("handles multiple admins", () => {
    const config = makeConfig({ admins: [ADMIN_JID, NON_ADMIN_JID] });
    expect(isAdmin(ADMIN_JID, config)).toBe(true);
    expect(isAdmin(NON_ADMIN_JID, config)).toBe(true);
  });
});

describe("isCommandGroup", () => {
  it("returns true for registered command group", () => {
    const config = makeConfig({
      groups: { command: [COMMAND_GROUP], announcement: [], alertAdmin: [] },
    });
    expect(isCommandGroup(COMMAND_GROUP, config)).toBe(true);
  });

  it("returns false for unregistered group", () => {
    const config = makeConfig({
      groups: { command: [COMMAND_GROUP], announcement: [], alertAdmin: [] },
    });
    expect(isCommandGroup(OTHER_GROUP, config)).toBe(false);
  });

  it("returns false when command groups list is empty", () => {
    const config = makeConfig({
      groups: { command: [], announcement: [], alertAdmin: [] },
    });
    expect(isCommandGroup(COMMAND_GROUP, config)).toBe(false);
  });
});

describe("isAnnouncementGroup", () => {
  it("returns true for registered announcement group", () => {
    const config = makeConfig({
      groups: {
        command: [],
        announcement: [ANNOUNCEMENT_GROUP],
        alertAdmin: [],
      },
    });
    expect(isAnnouncementGroup(ANNOUNCEMENT_GROUP, config)).toBe(true);
  });

  it("returns false for unregistered group", () => {
    const config = makeConfig({
      groups: {
        command: [],
        announcement: [ANNOUNCEMENT_GROUP],
        alertAdmin: [],
      },
    });
    expect(isAnnouncementGroup(OTHER_GROUP, config)).toBe(false);
  });

  it("returns false when announcement groups list is empty", () => {
    const config = makeConfig({
      groups: { command: [], announcement: [], alertAdmin: [] },
    });
    expect(isAnnouncementGroup(ANNOUNCEMENT_GROUP, config)).toBe(false);
  });
});

describe("canUseCommand", () => {
  const config = makeConfig({
    admins: [ADMIN_JID],
    groups: {
      command: [COMMAND_GROUP],
      announcement: [ANNOUNCEMENT_GROUP],
      alertAdmin: [],
    },
  });

  describe("admin commands", () => {
    const adminCommands = [
      "setreq",
      "config",
      "status",
      "catchup",
      "alerts",
      "schedule",
    ];

    it.each(adminCommands)(
      'allows admin command "%s" for admin in command group',
      (cmd) => {
        expect(canUseCommand(cmd, ADMIN_JID, COMMAND_GROUP, config)).toBe(true);
      },
    );

    it.each(adminCommands)(
      'blocks admin command "%s" for non-admin in command group',
      (cmd) => {
        expect(canUseCommand(cmd, NON_ADMIN_JID, COMMAND_GROUP, config)).toBe(
          false,
        );
      },
    );

    it.each(adminCommands)(
      'allows admin command "%s" for admin in private chat',
      (cmd) => {
        expect(canUseCommand(cmd, ADMIN_JID, PRIVATE_CHAT, config)).toBe(true);
      },
    );

    it.each(adminCommands)(
      'blocks admin command "%s" for non-admin in private chat',
      (cmd) => {
        expect(canUseCommand(cmd, NON_ADMIN_JID, PRIVATE_CHAT, config)).toBe(
          false,
        );
      },
    );

    it.each(adminCommands)(
      'blocks admin command "%s" for admin in non-command group',
      (cmd) => {
        expect(canUseCommand(cmd, ADMIN_JID, OTHER_GROUP, config)).toBe(false);
      },
    );
  });

  describe("report commands", () => {
    const reportCommands = [
      "daily",
      "weekly",
      "monthly",
      "ranks",
      "bottom",
      "stats",
      "members",
      "tier",
      "compare",
      "analyze",
    ];

    it.each(reportCommands)(
      'allows report command "%s" for admin in command group',
      (cmd) => {
        expect(canUseCommand(cmd, ADMIN_JID, COMMAND_GROUP, config)).toBe(true);
      },
    );

    it.each(reportCommands)(
      'allows report command "%s" for non-admin in command group',
      (cmd) => {
        expect(canUseCommand(cmd, NON_ADMIN_JID, COMMAND_GROUP, config)).toBe(
          true,
        );
      },
    );

    it.each(reportCommands)(
      'allows report command "%s" for admin in private chat',
      (cmd) => {
        expect(canUseCommand(cmd, ADMIN_JID, PRIVATE_CHAT, config)).toBe(true);
      },
    );

    it.each(reportCommands)(
      'blocks report command "%s" for non-admin in private chat',
      (cmd) => {
        expect(canUseCommand(cmd, NON_ADMIN_JID, PRIVATE_CHAT, config)).toBe(
          false,
        );
      },
    );

    it.each(reportCommands)(
      'blocks report command "%s" for non-admin in non-command group',
      (cmd) => {
        expect(canUseCommand(cmd, NON_ADMIN_JID, OTHER_GROUP, config)).toBe(
          false,
        );
      },
    );

    it.each(reportCommands)(
      'blocks report command "%s" for admin in non-command group',
      (cmd) => {
        expect(canUseCommand(cmd, ADMIN_JID, OTHER_GROUP, config)).toBe(false);
      },
    );
  });

  describe("unknown commands", () => {
    it("allows unknown command for admin", () => {
      expect(canUseCommand("unknown", ADMIN_JID, COMMAND_GROUP, config)).toBe(
        true,
      );
    });

    it("blocks unknown command for non-admin in non-command group", () => {
      expect(canUseCommand("unknown", NON_ADMIN_JID, OTHER_GROUP, config)).toBe(
        false,
      );
    });

    it("allows unknown command for non-admin in command group", () => {
      expect(
        canUseCommand("unknown", NON_ADMIN_JID, COMMAND_GROUP, config),
      ).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles empty admins list", () => {
      const cfg = makeConfig({
        admins: [],
        groups: { command: [COMMAND_GROUP], announcement: [], alertAdmin: [] },
      });
      expect(canUseCommand("setreq", NON_ADMIN_JID, COMMAND_GROUP, cfg)).toBe(
        false,
      );
    });

    it("handles empty groups", () => {
      const cfg = makeConfig({
        admins: [ADMIN_JID],
        groups: { command: [], announcement: [], alertAdmin: [] },
      });
      // Admin can use report commands in private chats
      expect(canUseCommand("daily", ADMIN_JID, PRIVATE_CHAT, cfg)).toBe(true);
      // Admin cannot use report commands in unconfigured group
      expect(canUseCommand("daily", ADMIN_JID, OTHER_GROUP, cfg)).toBe(false);
      // Non-admin cannot use in non-command group
      expect(canUseCommand("daily", NON_ADMIN_JID, PRIVATE_CHAT, cfg)).toBe(
        false,
      );
    });

    it("admin bypasses report group checks but not admin command group checks", () => {
      const cfg = makeConfig({
        admins: [ADMIN_JID],
        groups: {
          command: ["some-command@g.us"],
          announcement: [],
          alertAdmin: [],
        },
      });
      // Report commands: admin can only use in command groups or private chats
      expect(canUseCommand("daily", ADMIN_JID, "any-group@g.us", cfg)).toBe(
        false,
      );
      expect(canUseCommand("daily", ADMIN_JID, "some-command@g.us", cfg)).toBe(
        true,
      );
      expect(canUseCommand("daily", ADMIN_JID, PRIVATE_CHAT, cfg)).toBe(true);
      // Admin commands: restricted to command groups and private chats
      expect(canUseCommand("setreq", ADMIN_JID, "any-group@g.us", cfg)).toBe(
        false,
      );
      expect(canUseCommand("setreq", ADMIN_JID, "some-command@g.us", cfg)).toBe(
        true,
      );
    });
  });

  describe("help command (standard access)", () => {
    const cfg = makeConfig({
      admins: [ADMIN_JID],
      groups: {
        command: [COMMAND_GROUP],
        announcement: [ANNOUNCEMENT_GROUP],
        alertAdmin: [],
      },
    });

    it("allows help for admin in command group", () => {
      expect(canUseCommand("help", ADMIN_JID, COMMAND_GROUP, cfg)).toBe(true);
    });

    it("allows help for non-admin in command group", () => {
      expect(canUseCommand("help", NON_ADMIN_JID, COMMAND_GROUP, cfg)).toBe(
        true,
      );
    });

    it("allows help for admin in private chat", () => {
      expect(canUseCommand("help", ADMIN_JID, PRIVATE_CHAT, cfg)).toBe(true);
    });

    it("blocks help for non-admin in private chat", () => {
      expect(canUseCommand("help", NON_ADMIN_JID, PRIVATE_CHAT, cfg)).toBe(
        false,
      );
    });

    it("blocks help for admin in unconfigured group", () => {
      expect(canUseCommand("help", ADMIN_JID, OTHER_GROUP, cfg)).toBe(false);
    });

    it("blocks help for non-admin in unconfigured group", () => {
      expect(canUseCommand("help", NON_ADMIN_JID, OTHER_GROUP, cfg)).toBe(
        false,
      );
    });

    it("blocks help for non-admin in announcement group", () => {
      expect(
        canUseCommand("help", NON_ADMIN_JID, ANNOUNCEMENT_GROUP, cfg),
      ).toBe(false);
    });

    it("blocks help when no command groups configured", () => {
      const emptyCfg = makeConfig({
        admins: [],
        groups: { command: [], announcement: [], alertAdmin: [] },
      });
      expect(canUseCommand("help", NON_ADMIN_JID, OTHER_GROUP, emptyCfg)).toBe(
        false,
      );
    });
  });
});
