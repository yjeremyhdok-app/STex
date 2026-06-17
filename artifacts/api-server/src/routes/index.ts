import { Router, type IRouter } from "express";
import healthRouter from "./health";
import streamRouter from "./stream";
import channelsRouter from "./channels";

const router: IRouter = Router();

router.use(healthRouter);
router.use(streamRouter);
router.use(channelsRouter);

export default router;
