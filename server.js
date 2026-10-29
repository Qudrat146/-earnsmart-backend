require("dotenv").config();
const express = require("express");
const app = express();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const JWT_SECRET = process.env.JWT_SECRET || "earn-smart-super-secret-key-1234567890-very-long";
let users = [];
app.use(express.json());
app.use(require("cors")({origin:true}));
app.get("/", (req,res)=>res.json({status:"EarnSmart API ok", time: new Date()}));
app.get("/health",(req,res)=>res.json({ok:true}));
app.post("/api/register", async (req,res)=>{
  const {username,password}=req.body;
  if(!username||!password) return res.status(400).json({error:"Missing"});
  if(users.find(u=>u.username===username)) return res.status(400).json({error:"User exists"});
  const hash=await bcrypt.hash(password,10);
  const u={id:Date.now(),username,password_hash:hash,points:100};
  users.push(u);
  const token=jwt.sign({id:u.id,username},JWT_SECRET,{expiresIn:"7d"});
  res.json({token,user:{id:u.id,username,points:100}});
});
app.post("/api/login", async (req,res)=>{
  const {username,password}=req.body;
  let user=users.find(u=>u.username===username);
  if(!user) return res.status(400).json({error:"User not found"});
  const ok=await bcrypt.compare(password,user.password_hash);
  if(!ok) return res.status(400).json({error:"Wrong password"});
  const token=jwt.sign({id:user.id,username},JWT_SECRET,{expiresIn:"7d"});
  res.json({token,user:{id:user.id,username,points:user.points}});
});
app.get("/api/leaderboard",(req,res)=>{
  const list=[...users].sort((a,b)=>b.points-a.points).slice(0,20).map(u=>({username:u.username,points:u.points}));
  res.json({leaderboard:list});
});
app.listen(process.env.PORT||3000,()=>console.log("OK"));
module.exports=app;
