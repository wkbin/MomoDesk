import "./styles/global.css";
import { MomoDeskApp } from "./app/MomoDeskApp";

const canvas = document.querySelector<HTMLCanvasElement>("#pet-canvas");

if (!canvas) {
  throw new Error("Missing #pet-canvas");
}

const app = new MomoDeskApp(canvas);
app.start();
