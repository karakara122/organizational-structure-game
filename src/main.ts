import { GAME_TITLE } from "./config";

const app = document.getElementById("app");
if (app) {
  app.innerHTML = `
    <main style="font-family: sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem;">
      <h1>${GAME_TITLE}</h1>
      <p>準備ができました。ゲームはこれから作ります。</p>
    </main>
  `;
}
