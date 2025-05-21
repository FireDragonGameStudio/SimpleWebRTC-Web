// vite.config.js
import basicSsl from "@vitejs/plugin-basic-ssl";

export default {
  server: {
    host: true,
  },
  plugins: [basicSsl()],
};
