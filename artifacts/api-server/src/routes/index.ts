import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import smeRouter from "./sme";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(smeRouter);

export default router;
