import { Server, type Socket } from "socket.io";

interface AuthenticatedUser {
  id: number;
  username: string;
}

interface AuthenticatedSocket extends Socket {
  data: {
    user?: AuthenticatedUser;
  };
}

export default {
  async register({ strapi }: { strapi }) {
    strapi.log.info("Starting Socket.IO setup in register hook...");

    const io = new Server(strapi.server.httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token;

        if (!token) {
          strapi.log.warn("Socket connection attempt without token.");
          return next(new Error("Authentication error: No token provided."));
        }

        const verifiedData = await strapi
          .service("plugin::users-permissions.jwt")
          .verify(token);

        if (!verifiedData.id) {
          return next(new Error("Authentication error: Invalid token data."));
        }

        const user = await strapi
          .service("plugin::users-permissions.user")
          .fetch(verifiedData.id);

        if (!user) {
          return next(new Error("Authentication error: User not found."));
        }

        socket.data.user = user as AuthenticatedUser;
        strapi.log.info(
          `Socket connected: ${user.username} (ID: ${socket.id})`
        );

        next();
      } catch (err: any) {
        strapi.log.error("Socket Auth Error:", err.message);
        next(new Error("Authentication error"));
      }
    });

    io.on("connection", (socket: AuthenticatedSocket) => {
      const user = socket.data.user;

      if (!user) {
        strapi.log.error(
          `Socket ${socket.id} connected without authenticated user state.`
        );
        socket.disconnect();
        return;
      }

      socket.on("sendMessage", async (data) => {
        try {
          const messageContent = data.text;

          const newEntry = await strapi.entityService.create(
            "api::message.message",
            {
              data: {
                text: messageContent,
                author: user.id,
                publishedAt: new Date(),
              },
              populate: ["author"],
            }
          );

          io.emit("newMessage", newEntry);

          strapi.log.info(`Message from ${user.username}: ${messageContent}`);
        } catch (err: any) {
          strapi.log.error("Error handling 'sendMessage':", err);
          socket.emit("error", "Failed to send message.");
        }
      });

      socket.on("disconnect", () => {
        strapi.log.info(`Socket disconnected: ${user.username}`);
      });
    });

    (strapi as any).io = io;

    strapi.log.info("Socket.IO setup completed successfully.");
  },

  bootstrap() {},
};
