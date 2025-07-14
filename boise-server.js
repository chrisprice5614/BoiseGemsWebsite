require("dotenv").config() // Makes it so we can access .env file
const jwt = require("jsonwebtoken")//npm install jsonwebtoken dotenv
const bcrypt = require("bcrypt") //npm install bcrypt
const cookieParser = require("cookie-parser")//npm install cookie-parser
const express = require("express")//npm install express
const db = require("better-sqlite3")("data.db") //npm install better-sqlite3
const body_parser = require("body-parser")
const path = require('path');
const node_fetch = require("node-fetch")
const nodemailer = require("nodemailer")
const multer = require("multer")
const sharp = require('sharp');
const fs = require("fs");
const axios = require("axios");
const marked = require('marked');
const session = require('express-session');
const { verify } = require("crypto")

const MasterEmail = "chrisprice5614@gmail.com"
const online = true;

//mailing function
async function sendEmail(to, subject, html) {
  if(!online)
    return

    let transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
            user: process.env.MAILNAME,
            pass: process.env.MAILSECRET
        },
        tls: {
            rejectUnauthorized: false
        }
    });


    let info = await transporter.sendMail({
        from: '"Chris Price Music" <info@chrispricemusic.net>',
        to: to,
        subject: subject,
        html: `
        <!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Boise Gems Drum & Bugle Corps</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f4f4f4;
    }

    table {
      border-collapse: collapse;
    }

    @media only screen and (max-width: 600px) {
      .content {
        width: 100% !important;
      }
      .logo {
        width: 80px !important;
      }
    }
  </style>
</head>
<body>
  <!-- Main wrapper with padding on cell -->
  <table width="100%" bgcolor="#f4f4f4" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding: 24px;">
        <!-- Centered content table -->
        <table class="content" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; padding: 32px; font-family: Arial, sans-serif; color: #333333; border-radius: 6px; max-width: 600px; width: 100%;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <a href="https://www.boisegems.org/" target="_blank">
                <img src="https://raw.githubusercontent.com/chrisprice5614/chrisprice.io/refs/heads/main/gem.png" alt="Boise Gems Logo" width="100" class="logo" style="display: block; margin: 0 auto;">
              </a>
            </td>
          </tr>
          <!-- Title -->
          <tr>
            <td align="center" style="font-size: 24px; font-weight: bold; color: #60437D; padding-bottom: 12px;">
              Boise Gems Drum & Bugle Corps
            </td>
          </tr>
          <tr>
          </tr>
          <!-- Body -->
          <tr>
            <td style="font-size: 16px; line-height: 1.6; color: #333;">
              <p>${html}</p>

            
              </p>
              <p style="margin-top: 32px;">
                <strong>The Boise Gems</strong>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="font-size: 12px; color: #999999; padding-top: 32px;">
              © 2025 Boise Gems Drum & Bugle Corps ·
              <a href="https://www.boisegems.org/" style="color: #999999; text-decoration: underline;">www.boisegems.org</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>

        `

    })

}


db.pragma("journal_mode = WAL") //Makes it faster
const createTables = db.transaction(() => {
    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title STRING,
        description STRING,
        datetime STRING,
        location STRING,
        image STRING,
        link STRING,
        cost INTEGER,
        slug STRING
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS campdates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER,
        FOREIGN KEY (event_id) REFERENCES events(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS userVerify (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code STRING,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS emergencyContacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name STRING,
        phone STRING,
        email STRING,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS forgotPassword (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code STRING,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS childVerify (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code STRING,
        user_id INTEGER,
        target_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (target_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS forms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title STRING,
        description STRING,
        document_path STRING,
        upload BOOL,
        content STRING,
        expire_date INTEGER,
        season STRING,
        due_date INTEGER
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS formUploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signer_name STRING,
        signer_email STRING,
        upload_path STRING,
        document_id INTEGER,
        signed_date INTEGER,
        ip_address STRING,
        user_agent STRING,
        signature STRING,
        consent BOOL,
        user_id,
        FOREIGN KEY (document_id) REFERENCES forms(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS paymentHistory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title STRING,
        description STRING,
        amount INTEGER,
        method INTEGER,
        date INTEGER,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS contractedMembers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season INTEGER,
        ensemble STRING,
        contracted_date INTEGER,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firstname STRING,
        lastname STRING,
        birthday INTEGER,
        phone STRING,
        email STRING,
        address STRING,
        admin BOOL,
        section STRING,
        instrument STRING,
        paid INTEGER DEFAULT 0,
        owed INTEGER DEFAULT 0,
        staff STRING,
        password STRING,
        emailsecret STRING,
        verified BOOL,
        parentId INTEGER,
        parent BOOL,
        img STRING,
        contractedCorps INTEGER,
        contractedIndependent INTEGER
        )
        `
    ).run()

    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        full BOOL,
        upgrade BOOL,
        forms BOOL,
        posts BOOL,
        schedule BOOL,
        events BOOL,
        merch BOOL,
        contract BOOL,
        email BOOL,
        
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `
    ).run()

    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS contractExtension (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        due_date INTEGER,
        bypass_fee BOOL DEFAULT 0,
        season INTEGER,
        extender INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (extender) REFERENCES users(id)
        )
      `
    ).run()

    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS active (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pagename STRING,
        active BOOL
        )
      `
    ).run()

    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS forms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name STRING,
        description STRING,
        content STRING,
        required BOOL,
        expires STRING
        )
      `
    ).run()

    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS seasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name STRING,
        year INTEGER,
        content STRING,
        hero STRING
        )
      `
    ).run()
})

createTables();

const app = express()
app.use(express.json())
app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public")) //Using public folder
app.use(cookieParser())
app.use(express.static('/public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(body_parser.json())
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: true
}));

function generateCode(length = 4){
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
  let code = '';
  for(let i = 0; i < length; i ++){
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code;
}

function mustBeLoggedIn(req, res, next){
    if(req.user) {
        return next()
    }
    else
    {
        return res.redirect("/")
    }
}

function mustBeAdmin(req, res, next){
    if(req.admin) {
        return next()
    }
    else
    {
        return res.redirect("/")
    }
}

function mustBeStaff(req, res, next){
    if((req.admin) || (req.staff)) {
        return next()
    }
    else
    {
        return res.redirect("/")
    }
}

function mustBeParent(req, res, next){
    if(req.parent) {
        return next()
    }
    else
    {
        return res.redirect("/")
    }
}

function mustBeMember(req,res, next){
  if((!req.parent)&&(!req.staff)){
    if(!req.admin)
      return next();
  }

  res.redirect("/")
}

function getGraphicCenter(events) {
  if(!events.length) return null;

  let x = 0, y = 0, z = 0;
  for(const event of events) {
    const lat = event.coords[0] * Math.PI / 180;
    const lon = event.coords[1] * Math.PI / 180;

    x += Math.cos(lat) * Math.cos(lon)
    y += Math.cos(lat) * Math.sin(lon)
    z += Math.sin(lat)
  }

  const total = events.length;
  x/=total;
  y/=total;
  z/=total;

  const hyp = Math.sqrt(x * x + y * y)
  const lat = Math.atan2(z, hyp)
  const lon = Math.atan2(y, x)

  return [lat * 180/ Math.PI, lon * 180 / Math.PI];

}

const CURRENTSEASON = 2026;

app.use(function (req, res, next) {

  res.locals.CURRENTSEASON = CURRENTSEASON;

  if(req.session.flashMessage)
  {
    res.locals.flashMessage = req.session.flashMessage
    console.log(req.session.flashMessage)
    console.log(res.locals.flashMessage)
    delete req.session.flashMessage;
  }

  let errors = [];

    try {
        const decoded = jwt.verify(req.cookies.bgcookie, process.env.JWTSECRET)
        req.user = decoded
        
        req.admin = req.user.admin
        req.parent = req.user.parent
    } catch (err) {
        req.user = false
        req.admin = false;
        req.parent = false
        
    }

    res.locals.user = req.user;
    res.locals.admin = req.admin;
    res.locals.parent = req.parent;
    res.locals.errors = errors;

    next()
})

app.get("/", (req,res) => {
    return res.render("index", {admin: true})
})

app.get("/admin-portal", mustBeAdmin, (req,res) => {
  const memberStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const member = memberStatement.get(req.user.userid)
  return res.render("admin-portal", {member})
})

const coordinates = {
  'Boise, ID': [43.615, -116.202],
  'Salt Lake City, UT': [40.7608, -111.891],
  'Denver, CO': [39.7392, -104.9903],
  'Kennewick, WA' : [46.202,-119.120],
  'Hillsboro, OR' : [45.522,-122.989],
  'Seattle, WA' : [47.603,-122.330]
};



app.post("/register-parent", (req,res) => {
  let errors = [];

  let firstname = req.body.firstname || "";
  let lastname = req.body.lastname || "";
  let phone = req.body.phone || "";
  let email = req.body.email || "";
  let address = req.body.address || "";
  let password = req.body.password || "";
  let passwordRetype = req.body.passwordRetype || "";
  let birthday = new Date(req.body.birthday).getTime();
  

  firstname = req.body.firstname.trim()
  lastname = req.body.lastname.trim()
  phone = req.body.phone.trim()
  email = req.body.email.trim().toLowerCase()
  address = req.body.address.trim()

  placeholders = {firstname, lastname, phone, email, address, birthday};

  if(password.length < 8)
    errors.push("Your password must be at least 8 characters long")

  //Checking if email already exists
  const checkEmailstatement = db.prepare("SELECT * FROM users WHERE email = ?")
  const EmailExists = checkEmailstatement.get(email);

  if(EmailExists)
    errors.push("Email is already in use")

  if(password !== passwordRetype)
    errors.push("Passwords do not match")
  
  res.locals.errors = errors;
  
  if(errors.length)
    return res.render("register-parent", {placeholders})

  const salt = bcrypt.genSaltSync(10)
  password = bcrypt.hashSync(password, salt)
  
  const emailsecret = bcrypt.hashSync(firstname + Date.now().toString(), salt).replace(/[^a-zA-Z0-9]/g, '')

  const addParent = db.prepare("INSERT INTO users (firstname, lastname, password, address, birthday, email, phone, verified, parent, section) VALUES (? , ? , ? , ? , ? , ? , ? , ? , ? , ?)")
  const newParent = addParent.run(firstname, lastname, password, address, birthday, email, phone, 0, 1, parent)
  const parentId = newParent.lastInsertRowid;


  const addEmailVerify = db.prepare("INSERT INTO userVerify (code, user_id) VALUES (? , ?)")
  addEmailVerify.run(emailsecret, parentId);

  const html = `
    Hello ${firstname},

    Please click the button below to verify your account!
    <br/>
    <p style="text-align: center; margin: 32px 0;">
                <a href="${process.env.BASEURL}/verify/${emailsecret}" target="_blank" style="background-color: #9D76BB; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">
                  Verify Account
                </a>
              </p>
    <br/>
    If the button above isn't working, please click here: <a href="${process.env.BASEURL}/verify/${emailsecret}">${process.env.BASEURL}/verify/${emailsecret}</a>
  `

  sendEmail(email,"Verify Your Account", html)

  return res.redirect("/check-email")
})

app.get("/verify/:id", (req,res) => {
  const verifyCheck = req.params.id;

  const findVerify = db.prepare("SELECT * FROM userVerify WHERE code = ?")
  const verificationData = findVerify.get(verifyCheck);

  if(!verificationData)
  {
    return res.redirect("/")
  }

  const verifiedUserId = verificationData.user_id;

  const updateStatement = db.prepare("UPDATE users SET verified = 1 WHERE id = ?")
  updateStatement.run(verifiedUserId)

  const deleteStatement = db.prepare("DELETE FROM userVerify WHERE code = ?")
  deleteStatement.run(verifyCheck)

  const userStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const userInQuestion = userStatement.get(verifiedUserId)

  //Logging in
  // log the user in by giving them a cookie
  const ourTokenValue = jwt.sign({exp: Math.floor(Date.now() / 1000) + (60*60*24*3), userid: userInQuestion.id, firstname: userInQuestion.firstname, lastname: userInQuestion.lastname, email: userInQuestion.email, admin: userInQuestion.admin, staff: userInQuestion.staff, parent: userInQuestion.parent}, process.env.JWTSECRET) //Creating a token for logging in
  
  res.cookie("bgcookie",ourTokenValue, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 1000 * 60 * 60 * 24
  }) //name, string to remember,

  req.session.flashMessage = "Account verified!"
  return res.redirect("/")
})

app.post("/register-member", (req,res) => {
  let errors = [];

  let firstname = req.body.firstname || "";
  let lastname = req.body.lastname || "";
  let phone = req.body.phone || "";
  let email = req.body.email || "";
  let address = req.body.address || "";
  let password = req.body.password || "";
  let passwordRetype = req.body.passwordRetype || "";
  let birthday = new Date(req.body.birthday).getTime();
  

  firstname = req.body.firstname.trim()
  lastname = req.body.lastname.trim()
  phone = req.body.phone.trim()
  email = req.body.email.trim().toLowerCase()
  address = req.body.address.trim()
  section = req.body.section.trim()
  instrument = req.body.instrument.trim()

  placeholders = {firstname, lastname, phone, email, address, birthday, section, instrument};

  if(password.length < 8)
    errors.push("Your password must be at least 8 characters long")

  //Checking if email already exists
  const checkEmailstatement = db.prepare("SELECT * FROM users WHERE email = ?")
  const EmailExists = checkEmailstatement.get(email);

  if(EmailExists)
    errors.push("Email is already in use")

  if(password !== passwordRetype)
    errors.push("Passwords do not match")
  
  res.locals.errors = errors;
  
  if(errors.length)
    return res.render("register-member", {placeholders})

  const salt = bcrypt.genSaltSync(10)
  password = bcrypt.hashSync(password, salt)
  
  const emailsecret = bcrypt.hashSync(firstname + Date.now().toString(), salt).replace(/[^a-zA-Z0-9]/g, '')

  const addMember = db.prepare("INSERT INTO users (firstname, lastname, password, address, birthday, email, phone, verified, emailsecret, section, instrument) VALUES (? , ? , ? , ? , ? , ? , ? , ? , ? , ? , ?)")
  const newMember = addMember.run(firstname, lastname, password, address, birthday, email, phone, 0, emailsecret, section, instrument)

  const newMemberId = newMember.lastInsertRowid;

  const addEmailVerify = db.prepare("INSERT INTO userVerify (code, user_id) VALUES (? , ?)")
  addEmailVerify.run(emailsecret, newMemberId);

  const addPermissions = db.prepare("INSERT INTO permissions (user_id) VALUES (?)")
  addPermissions.run(newMemberId)
  

  const html = `
    Hello ${firstname},

    Please click the button below to verify your account!
    <br/>
    <p style="text-align: center; margin: 32px 0;">
                <a href="${process.env.BASEURL}/verify/${emailsecret}" target="_blank" style="background-color: #9D76BB; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">
                  Verify Account
                </a>
              </p>
    <br/>
    If the button above isn't working, please click here: <a href="${process.env.BASEURL}/verify/${emailsecret}">${process.env.BASEURL}/verify/${emailsecret}</a>
  `

  sendEmail(email,"Verify Your Account", html)

  return res.redirect("/check-email")
})

app.get("/check-email", (req,res) => {
  return res.render("check-email")
})



// Predefined lat/lng values (normally from a geocoder)



// Route for /tour
app.get('/tour', (req, res) => {



  res.render('tour-map', { events });
});

app.get("/login", (req,res) => {
  if(req.user)
    return res.redirect("/")
  res.render("login")
})

app.get("/register", (req,res) => {
  if(req.user)
    return res.redirect("/")
  res.render("register");
})

app.get("/register-parent", (req,res) => {
  if(req.user)
    return res.redirect("/")
  return res.render("register-parent")
})

app.get("/register-member", (req,res) => {
  return res.render("register-member", {placeholders: undefined})
})

app.get("/add-member", mustBeParent, (req,res) => {
  return res.render("add-member", {placeholders: undefined})
})

app.get("/logout", mustBeLoggedIn, (req,res) => {
  res.clearCookie("bgcookie")

  return res.redirect("/")
})

app.get("/forgot-password", (req,res) => {
  if(req.user)
    return res.redirect("/")

  return res.render("forgot-password")
})

app.get("/member-portal", mustBeMember, (req,res) => {

  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const member = getUserStatement.get(req.user.userid)

  const getContractStatement = db.prepare("SELECT * FROM contractExtension WHERE user_id = ?")
  const contracts = getContractStatement.all(req.user.userid)

  return res.render("member-portal", {member, contracts})
})

app.post("/forgot-password", (req,res) => {
  let errors = [];
  const email = req.body.email

  const findUser = db.prepare("SELECT * FROM users WHERE email = ?")
  const user = findUser.get(email)

   if(!user)
  {
    errors.push("Email does not exist in our system")
    return res.render("forgot-password", {errors})
  }

  const oldReset = db.prepare("DELETE FROM forgotPassword WHERE user_id = ?")
  oldReset.run(user.id)

 

  const salt = bcrypt.genSaltSync(10)
  const emailsecret = bcrypt.hashSync(user.email + Date.now().toString(), salt).replace(/[^a-zA-Z0-9]/g, '')

  const forgotPassword = db.prepare("INSERT INTO forgotPassword (code, user_id) VALUES (? , ?)")
  forgotPassword.run(emailsecret, user.id);

  const html = `
    Hello ${user.firstname},

    An attempt to reset your password was made. If this was not you, please ignore this email. If this was you, reset your password below
    <br/>
    <p style="text-align: center; margin: 32px 0;">
                <a href="${process.env.BASEURL}/reset-password/${emailsecret}" target="_blank" style="background-color: #9D76BB; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">
                  Reset Password
                </a>
              </p>
    <br/>
    If the button above isn't working, please click here: <a href="${process.env.BASEURL}/reset-password/${emailsecret}">${process.env.BASEURL}/reset-password/${emailsecret}</a>
  `

  sendEmail(email,"Reset Your Password", html)

  return res.render("message", {message: "A link has been sent to your email to reset your password."})

})

app.get("/reset-password/:id", (req,res) => {
  const findReset = db.prepare("SELECT * FROM forgotPassword WHERE code = ?")
  const resetData = findReset.get(req.params.id)

  if(!resetData)
    return res.redirect("/")

  const code = req.params.id
  const userId = resetData.user_id

  return res.render("reset-password", {code, userId})
})

app.post("/reset-password/:id", (req,res) => {
  const findReset = db.prepare("SELECT * FROM forgotPassword WHERE code = ?")
  const resetData = findReset.get(req.params.id)

  let password = req.body.password;
  const passwordRetype = req.body.passwordRetype
  const code = req.params.id

  if(!resetData)
    return res.redirect("/")

  if(password!=passwordRetype)
  {
    errors = ["Passwords do not match."]
    return res.render("reset-password",{errors,code})
  }

  
  const userId = resetData.user_id

  const salt = bcrypt.genSaltSync(10)
  password = bcrypt.hashSync(password, salt)

  const updatePassword = db.prepare("UPDATE users SET password = ? WHERE id = ?")
  updatePassword.run(password, userId)

  const deleteData = db.prepare("DELETE FROM forgotPassword WHERE user_id = ?")
  deleteData.run(userId)

  req.session.flashMessage = `Your password has been reset.`
  return res.redirect("/")
})

app.post("/login", (req,res) => {
  errors = [];

  const email = req.body.email.trim().toLowerCase()
  const password = req.body.password;

  const getUserStatement = db.prepare("SELECT * FROM users WHERE email = ?")
  const userInQuestion = getUserStatement.get(email);

  if(!userInQuestion)
  {
    errors.push("Invalid email/password")
    return res.render("login", {errors})
  }

  if(userInQuestion.verified == false)
  {
    errors.push("Please verify your account!")
    return res.render("login", {errors})
  }

  const matchOrNot = bcrypt.compareSync(req.body.password, userInQuestion.password)
  if(!matchOrNot)
  {
    errors=["Invalid email/password"]
    return res.render("login", {errors})
  }

  //Logging in
  // log the user in by giving them a cookie
  const ourTokenValue = jwt.sign({exp: Math.floor(Date.now() / 1000) + (60*60*24*3), userid: userInQuestion.id, firstname: userInQuestion.firstname, lastname: userInQuestion.lastname, email: userInQuestion.email, admin: userInQuestion.admin, staff: userInQuestion.staff, parent: userInQuestion.parent}, process.env.JWTSECRET) //Creating a token for logging in
  
  res.cookie("bgcookie",ourTokenValue, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 1000 * 60 * 60 * 24
  }) //name, string to remember,

  return res.redirect("/")

})

app.get("/change-account-type/:id", mustBeAdmin, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  return res.render("change-account-type", {thisUser})
})

app.post("/change-account-type/:id", mustBeAdmin, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  const change = req.body.type;

  let parent = 0;
  let admin = 0;
  let staff = 0;
  if(change == "parent")
    parent = 1;

  if(change == "admin")
    admin = 1;

  if(change == "staff")
    staff = 1;

  const updateStatement = db.prepare("UPDATE users SET parent = ?, admin = ?, staff = ? WHERE id = ?")
  updateStatement.run(parent,admin,staff, userId);

  req.session.flashMessage = `${thisUser.firstname} has been changed to ${change}.`
  return res.redirect("/edit-users")

})

app.get("/change-membership/:id", mustBeAdmin,(req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  if(thisUser.parent){
    req.session.flashMessage = `${thisUser.firstname} is a parent. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  if(thisUser.admin){
    req.session.flashMessage = `${thisUser.firstname} is an admin. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  if(thisUser.staff){
    req.session.flashMessage = `${thisUser.firstname} is staff. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  return res.render("change-membership", {thisUser})
})

app.get('/contact', (req,res) => {
  return res.render('contact')
})



app.post("/contact", (req,res) => {
  const name = req.body.name;
  const email = req.body.email;
  const message = req.body.content;

  const html =`
  <h1>Message from ${name}</h1>
  <p>${message}</p>
  <p>${name}'s email: ${email}</p>
  `

  sendEmail(MasterEmail,"Contact Submission Received", html)

  return res.render("message", {message: "Thank you! Your message has been sent and we'll get back to you soon!"})
})

app.post("/change-membership/:id", mustBeAdmin, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }


  const changeCorps = req.body.typeCorps;
  const changeIndependent = req.body.typeIndependent;

  let contractedCorps = 0;
  let contractedIndependent = 0;

  if(changeCorps == "contracted")
    contractedCorps = 1

  if(changeIndependent == "contracted")
    contractedIndependent = 1

  const updateStatement = db.prepare("UPDATE users SET contractedCorps = ? , contractedIndependent = ? WHERE id = ?")
  updateStatement.run(contractedCorps, contractedIndependent, userId)
  

  req.session.flashMessage = `${thisUser.firstname} has been changed to contracted for corps is ${changeCorps} and for Independent is ${changeIndependent}`


  return res.redirect("/edit-users")
})

app.get("/extend-contract/:id", mustBeStaff, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  if(thisUser.parent){
    req.session.flashMessage = `${thisUser.firstname} is a parent. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  if(thisUser.admin){
    req.session.flashMessage = `${thisUser.firstname} is an admin. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  if(thisUser.staff){
    req.session.flashMessage = `${thisUser.firstname} is staff. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }



  return res.render("extend-contract",{thisUser})
})

app.get("/accept-contract/:id", mustBeLoggedIn, (req,res) => {
  const getContractStatement = db.prepare("SELECT * FROM contractExtension WHERE id = ?")
  const contractExtension = getContractStatement.get(req.params.id);

  if(contractExtension.user_id != req.user.userid)
  {
    return res.redirect("/")
  }

  if(!contractExtension){
    return res.redirect("/")
  }

  let group = "Independent"

  if (contractExtension.season.includes("corps")) {
    group = "Drum & Bugle Corps";
  }

  return res.render("accept-contract",{group, season: CURRENTSEASON, contractExtension})
})

app.get("/sign-contract/:id", mustBeLoggedIn, (req,res) => {
  const getContractStatement = db.prepare("SELECT * FROM contractExtension WHERE id = ?")
  const contractExtension = getContractStatement.get(req.params.id);

  if(contractExtension.user_id != req.user.userid)
  {
    return res.redirect("/")
  }

  if(!contractExtension){
    return res.redirect("/")
  }

  let group = "Independent"

  if (contractExtension.season.includes("corps")) {
    group = "Drum & Bugle Corps";
  }

  return res.render("sign-contract",{group, season: CURRENTSEASON, contractExtension})
})

app.post("/sign-contract/:id", mustBeLoggedIn, (req,res) => {
  const getContractStatement = db.prepare("SELECT * FROM contractExtension WHERE id = ?")
  const contractExtension = getContractStatement.get(req.params.id);

  if(contractExtension.user_id != req.user.userid)
  {
    return res.redirect("/")
  }

  if(!contractExtension){
    return res.redirect("/")
  }

  

  if (contractExtension.season.includes("corps")) {
    const updateStatement = db.prepare("UPDATE users SET contractedCorps = 1 WHERE id = ?")
    updateStatement.run(req.user.userid)
  } else {
    const updateStatement = db.prepare("UPDATE users SET contractedIndependent = 1 WHERE id = ?")
    updateStatement.run(req.user.userid)
  }

  const deleteStatement = db.prepare("DELETE FROM contractExtension WHERE id = ?")
  deleteStatement.run(req.params.id);

  res.session.flashMessage = "Welcome to the corps!";
  return res.redirect("/member-portal")
})


app.post("/extend-contract/:id", mustBeStaff, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);
  const group = req.body.group;

  const bypass = req.body.bypass ? 1 : 0;

  if(!thisUser){
    return res.redirect("/")
  }

  if(thisUser.parent){
    req.session.flashMessage = `${thisUser.firstname} is a parent. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  if(thisUser.admin){
    req.session.flashMessage = `${thisUser.firstname} is an admin. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  if(thisUser.staff){
    req.session.flashMessage = `${thisUser.firstname} is staff. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  const seasonString = String(CURRENTSEASON)+group;

  const oldContractStatement = db.prepare("SELECT * FROM contractExtension WHERE user_id = ?")
  const oldContractArray = oldContractStatement.all(userId)

  oldContractArray.forEach(oldContract => {
    if(oldContract.season == seasonString)
    {
      const deleteStatement = db.prepare("DELETE FROM contractExtension WHERE id = ?")
      deleteStatement.run(oldContract.id)
    }
  })

  const addContractExtensionStatement = db.prepare("INSERT INTO contractExtension (user_id , due_date , bypass_fee , season , extender) VALUES (? , ? , ? , ? , ?)")
  addContractExtensionStatement.run(thisUser.id, Date.now() + 30 * 24 * 60 * 60 * 1000, bypass, seasonString, req.user.userid)

  let welcomeMessage = "The Boise Gems Drum & Bugle Corps"

  if(group == "independent"){
    welcomeMessage = "Boise Gems Independent"
  }

  const html = `<h1 style="text-align: center;">Congratulations!</h1>
  <br>
  <p>Hello ${thisUser.firstname}, you've been offered a contract at ${welcomeMessage}! Please login and go to your member portal to view the contract and sign it. We're excited to have you with us for the ${CURRENTSEASON} season!</p><br>
  <div style="text-align: center">
    <a href="${process.env.BASEURL}/login" target="_blank" style="background-color: #9D76BB; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">
                  Log In To Your Account
                </a>
  </div>`

  sendEmail(thisUser.email,"Contract Extension", html)


  return res.render("message", {message: "Contract has been sent!"})
})



app.get("/view-forms/:id", mustBeAdmin, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  const getRequiredForms = db.prepare("SELECT * FROM forms WHERE expire_date > ?")
  const forms = getRequiredForms.all(new Date().getTime())


  const userFormsStatement = db.prepare("SELECT * FROM formUploads WHERE user_id = ?")
  const userForms = userFormsStatement.all(req.params.id)


  return res.render("user-forms",{forms, userForms, thisUser})
})

app.get("/change-email/:id", mustBeAdmin, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  return res.render("change-email", {thisUser})
})

app.post("/change-email/:id", mustBeAdmin, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  const emailExistsCheck = db.prepare("SELECT * FROM users WHERE email = ?")
  const EmailExists = emailExistsCheck.get(req.body.email)

  if(EmailExists){
    errors = ["Email already exists"]
    return res.render("change-email",{errors, thisUser})
  }

  const updateStatement = db.prepare("UPDATE users SET email = ? WHERE id = ?")
  updateStatement.run(req.body.email, userId);

  const html = `Hello ${thisUser.firstname},<br>
  Your email has been changed to this one you're using, ${thisUser.req.body.email}.`

  sendEmail(req.body.email,"Email Change", html)

  req.session.flashMessage = `Email updated for ${thisUser.firstname} to ${req.body.email}`
  return res.redirect("/edit-users")
})

app.get("/transaction-edit/:id", mustBeAdmin, (req,res) => {

  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  const getPayments = db.prepare("SELECT * FROM paymentHistory WHERE user_id = ? ORDER BY date DESC")
  const payments = getPayments.all(userId)

  return res.render("transaction-history",{payments, thisUser})
})

app.get("/edit-users", mustBeAdmin, (req,res) => {

  const search = req.query.search || ""
  const filter = req.query.filter || "all"
  let page = req.query.page || 1

  var getUserStatement;
  var users;

  const limit = 20;
  const offSet = (page - 1) * limit
  

  if(filter!="all")
  {
    getUserStatement = db.prepare("SELECT * FROM users WHERE section = ? AND (firstname LIKE ? OR lastname LIKE ?) ORDER BY lastname COLLATE NOCASE LIMIT ? OFFSET ?")
    users = getUserStatement.all(filter,`%${search}%`,`%${search}%`, limit, offSet)

    count = db.prepare("SELECT COUNT(*) as total FROM users WHERE section = ? AND (firstname LIKE ? OR lastname LIKE ?) ORDER BY lastname COLLATE NOCASE").get(filter,`%${search}%`,`%${search}%`).total;
  }
  else
  {
    getUserStatement = db.prepare("SELECT * FROM users WHERE firstname LIKE ? OR lastname LIKE ? ORDER BY section, lastname COLLATE NOCASE LIMIT ? OFFSET ?")
    users = getUserStatement.all(`%${search}%`,`%${search}%`, limit, offSet)

    count = db.prepare("SELECT COUNT(*) as total FROM users WHERE firstname LIKE ? OR lastname LIKE ?").get(`%${search}%`,`%${search}%`).total;
  }

  const getRequiredForms = db.prepare("SELECT * FROM forms WHERE expire_date > ?")
  const forms = getRequiredForms.all(Date().now)



  const totalPages = Math.ceil(count / limit)

  users.forEach(thisUser => {
    let getUserForms = db.prepare("SELECT * FROM formUploads WHERE user_id = ?")
    let userForms = getUserForms.all(String(thisUser.id))

    thisUser.allForms = 1;

    if(userForms.length == 0)
      thisUser.allForms = 0;
    
    forms.forEach(form => {
      found = userForms.some(item => item.document_id === form.id)
      if(!found)
        thisUser.allForms = 0
    })
  })

  return res.render("edit-users", {users, search, filter, page, count, totalPages})
})

app.get("/send-message/:id", mustBeAdmin, (req,res) => {
  const sendId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(sendId)

  if(!thisUser)
    return res.redirect("/")

  return res.render("send-message", {thisUser})
})

app.get("/shows/2025-the-animated", (req,res) => {
  res.render("show-2025")
})

app.post("/send-message/:id", mustBeAdmin, (req,res) => {
  const sendId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(sendId)

  if(!thisUser)
    return res.redirect("/")

  sendEmail(thisUser.email, req.body.subject, req.body.message)

  req.session.flashMessage = `Email has been sent to ${thisUser.email}`
  return res.redirect("/edit-users")
})

app.get("/edit-section/:id", mustBeAdmin, (req,res) => {
  const sendId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(sendId)

  if(!thisUser)
    return res.redirect("/")

  if(thisUser.parent)
  {
    req.session.flashMessage = `${thisUser.firstname} is a parent. You can't edit their section.`
    return res.redirect(req.get('Referer'))
  }

  return res.render("edit-section", {thisUser})
})

app.post("/edit-section/:id", mustBeAdmin, (req,res) => {
  const sendId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(sendId)

  if(!thisUser)
    return res.redirect("/")

  const updateStatement = db.prepare("UPDATE users SET section = ?, instrument = ? WHERE id = ?")
  updateStatement.run(req.body.section,req.body.instrument,sendId);

  req.session.flashMessage = `Updated ${thisUser.firstname}'s section to ${req.body.section} and instrument/role to ${req.body.instrument}`
  return res.redirect("/edit-users")
})

app.get("/add-parent/:id", (req,res) => {

  const getParentIdStatement = db.prepare("SELECT * FROM childVerify WHERE code = ?")
  const verifyItem = getParentIdStatement.get(req.params.id);
  const verifyId = verifyItem.target_id;

  if(!verifyItem)
  {
    return res.redirect("/")
  }

  const parentId = verifyItem.user_id;

  if(!req.user)
  {
    return res.render("message", {message: "Please login first before adding a parent/guardian"})
  }

  if(req.user.userid != verifyId)
  {
    return res.redirect("/")
  }

  const updateStatement = db.prepare("UPDATE users SET parentId = ? WHERE id = ?")
  updateStatement.run(parentId, req.user.userid);

  const deleteStatement = db.prepare("DELETE FROM childVerify WHERE user_id = ?")
  deleteStatement.run(parentId);

  const parentStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const parent = parentStatement.get(parentId);

  return res.render("message", {message: `You have added ${parent.firstname} ${parent.lastname} as a parent/guardian.`})

})

app.get("/shows", (req,res) => {
  return res.render("shows")
})

app.get("/shows/2023-esto-perpetua", (req,res) => {
  const events = [
    { date: '2023-07-10', location: 'Kennewick, WA' },
    { date: '2023-07-11', location: 'Boise, ID' },
    { date: '2023-07-12', location: 'Salt Lake City, UT' },
  ];

  // Attach coordinates to events
  events.forEach(event => {
    event.coords = coordinates[event.location];
  });

  const center = getGraphicCenter(events)

  console.log(center)

  return res.render("show-2023", {events ,center})
})

app.get("/update-emergency/:id", mustBeLoggedIn, (req,res) => {
  const getEmergencyStatement = db.prepare("SELECT * FROM emergencyContacts WHERE user_id = ?")
  const emergencyContacts = getEmergencyStatement.all(req.params.id)

  return res.render("update-emergency", {emergencyContacts})
})

app.post('/update-emergency/:userId', mustBeLoggedIn, (req, res) => {
    const userId = parseInt(req.params.userId);
    const contacts = req.body.contacts; // This is an object keyed by ID

    const insertStmt = db.prepare(`
        INSERT INTO emergencyContacts (name, phone, email, user_id)
        VALUES (?, ?, ?, ?)
    `);

    const updateStmt = db.prepare(`
        UPDATE emergencyContacts
        SET name = ?, phone = ?, email = ?
        WHERE id = ? AND user_id = ?
    `);

    const userContacts = Object.values(contacts); // each one has id, name, phone, email

    for (const contact of userContacts) {
        const { id, name, phone, email } = contact;

        if (parseInt(id) === -1) {
            // New contact
            insertStmt.run(name, phone, email, userId);
        } else {
            // Existing contact
            updateStmt.run(name, phone, email, id, userId);
        }
    }

    res.redirect('/member-portal'); // or another success page
});

app.post("/add-member", mustBeParent, (req,res) => {
  errors = [];
  const email = req.body.email;

  const getPreviousAttempt = db.prepare("SELECT * FROM childVerify WHERE user_id = ?")
  const previousAttempt = getPreviousAttempt.get(req.user.userid)

  if(previousAttempt)
  {
    const deleteStatement = db.prepare("DELETE FROM childVerify WHERE user_id = ?")
    deleteStatement.run(req.user.userid)
  }

  const userStatement = db.prepare("SELECT * FROM users WHERE email = ?")
  const user = userStatement.get(email)

  if(!user)
  {
    errors.push("Email does not exist. Make sure your child has registered an account.")
    return res.render("add-member", {errors})
  }

  if(user.id == req.user.userid)
  {
    errors.push("Cannot use your own email.")
  }

  if(errors.length > 0){
    return res.render("add-member", {errors})
  }

  const salt = bcrypt.genSaltSync(10)
  const emailsecret = bcrypt.hashSync(req.user.lastname + Date.now().toString(), salt).replace(/[^a-zA-Z0-9]/g, '')

  const verifyEmailStatment = db.prepare("INSERT INTO childVerify (code , user_id, target_id) VALUES (? , ? , ?)")
  verifyEmailStatment.run(emailsecret, req.user.userid, user.id);

  const html = `
    Hello ${user.firstname},

    ${req.user.firstname} ${req.user.lastname} has request to be your parent/guardian. Please click the button below to set them as your parent/guardian.
    <br/>
    <p style="text-align: center; margin: 32px 0;">
                <a href="${process.env.BASEURL}/add-parent/${emailsecret}" target="_blank" style="background-color: #9D76BB; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">
                  Add Parent/Guardian
                </a>
              </p>
    <br/>
    If the button above isn't working, please click here: <a href="${process.env.BASEURL}/add-parent/${emailsecret}">${process.env.BASEURL}/add-parent/${emailsecret}</a>
  `

  sendEmail(email,"Request to add Parent/Guardian", html)

  return res.render("message",{message: `An email has been sent to ${email} to confirm that you're their parent/guardian. Have them check their email.`})
})

app.get("/parent-portal", mustBeParent, (req,res) => {
  const getMember = db.prepare("SELECT * FROM users WHERE id = ?")
  const member = getMember.get(req.user.userid)

  const getChildren = db.prepare("SELECT * FROM users WHERE parentId = ?")
  const children = getChildren.all(req.user.userid)

  return res.render("parent-portal", {member, children})
})

app.get("/pay-behalf/:id", mustBeParent, (req,res) => {
  //Check if child is yours
  const getChildStatement = db.prepare("SELECT * FROM users WHERE id = ? AND parentId = ?")
  const child = getChildStatement.get(req.params.id,req.user.userid);

  if(!child)
  {
    return res.redirect("/parent-portal")
  }

  return res.render("pay-child", {child})
})

app.get("/edit-forms",mustBeAdmin, (req,res) => {

  const getFormsStatement = db.prepare("SELECT * FROM forms ORDER BY id DESC")
  const forms = getFormsStatement.all()

  return res.render("edit-forms",{forms})
})

app.post("/add-form", mustBeAdmin, (req,res) => {
   
  const title = req.body.title
  const description = req.body.description
  const upload = req.body.upload
  const expire_date = req.body.expire_date
  const due_date = req.body.due
  const content = req.body.content

  const addFormStatement = db.prepare("INSERT INTO forms (title, description, upload, expire_date, due_date, content) VALUES (? , ? , ? , ? , ? , ?)")
  addFormStatement.run(title, description, upload, new Date(expire_date).getTime(), new Date(due_date).getTime(), content)


  req.session.flashMessage = "Form added"
  return res.redirect("/edit-forms")
})

app.get("/add-form", mustBeAdmin, (req,res) => {
  return res.render("add-form")
})

app.post("/pay-behalf/:id", mustBeParent, (req,res) => {
  const getChildStatement = db.prepare("SELECT * FROM users WHERE id = ? AND parentId = ?")
  const child = getChildStatement.get(req.params.id,req.user.userid);

  if(!child)
  {
    return res.redirect("/parent-portal")
  }

  

  const paid = req.body.payment * 100;
  const alreadyPaid = Number(child.paid) + paid;
  const left = Number(child.owed)-paid;

  const updateStatement = db.prepare("UPDATE users SET paid = ?, owed = ? WHERE id = ?")
  updateStatement.run(alreadyPaid, left, req.params.id)

  const paidString = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(paid / 100);

  const addPaymentStatement = db.prepare("INSERT INTO paymentHistory (title, description, amount, method, date, user_id) VALUES (? , ? , ? , ? , ? , ?)")
  addPaymentStatement.run(`Payment for ${child.firstname} ${child.lastname} by parent, ${req.user.firstname} ${req.user.lastname}`, `Parent ${req.user.firstname} ${req.user.lastname} paid for thier child, ${child.firstname} ${child.lastname} with an amount of ${paidString}.`, paid, "Stripe", Date.now(), child.id)

const emailBody = `
  <h1 style="text-align: center;">Payment Received!</h1>
  <br/>
  <p>
    We have received a payment from ${req.user.firstname} ${req.user.lastname} for 
    ${child.firstname} ${child.lastname}'s tuition. The amount paid was ${paidString}, 
    being paid through Stripe on 
    ${new Date(Date.now()).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })}
  </p>
`;


  sendEmail(req.user.email,"Payment Received!", emailBody)
  sendEmail(MasterEmail,"Payment Received!", emailBody)

  return res.redirect("/payment-received")
})

app.get("/payment-received", (req,res) => {
  return res.render("payment-received")
})

app.use((req, res) => {
    res.status(404).render('404');
});

app.listen(2023)