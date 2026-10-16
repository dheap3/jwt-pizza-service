const request = require("supertest");
const app = require("../service");
const { Role, DB } = require("../database/database.js");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;
let testUserId;

beforeAll(async () => {
  testUser.email = `${randomName()}@test.com`;
  const registerRes = await request(app).post("/api/auth").send(testUser);
  testUserAuthToken = registerRes.body.token;
  testUserId = registerRes.body.user.id;
  expectValidJwt(testUserAuthToken);
});

test("get current user", async () => {
  const userRes = await request(app).get("/api/user/me").set("Authorization", `Bearer ${testUserAuthToken}`);

  expect(userRes.status).toBe(200);
  expect(userRes.body).toMatchObject({
    id: testUserId,
    name: testUser.name,
    email: testUser.email,
    roles: [{ role: "diner" }],
  });
});

test("update user", async () => {
  const updatedUser = {
    name: `Updated ${randomName()}`,
    email: `${randomName()}@test.com`,
    password: "updated-password",
  };
  const userRes = await request(app)
    .put(`/api/user/${testUserId}`)
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send(updatedUser);

  expect(userRes.status).toBe(200);
  expect(userRes.body.user).toMatchObject({
    id: testUserId,
    name: updatedUser.name,
    email: updatedUser.email,
    roles: [{ role: "diner" }],
  });
  expectValidJwt(userRes.body.token);
});

test("delete user unauthorized", async () => {
  const [user] = await registerUser(request(app));
  const deleteRes = await request(app).delete(`/api/user/${user.id}`);
  expect(deleteRes.status).toBe(401);
});

test("delete user - not admin", async () => {
  const [user, userToken] = await registerUser(request(app));
  const deleteRes = await request(app)
    .delete(`/api/user/${user.id}`)
    .set("Authorization", "Bearer " + userToken);
  expect(deleteRes.status).toBe(403);
});

test("delete user - admin", async () => {
  const [user] = await registerUser(request(app));
  const deleteRes = await request(app)
    .delete(`/api/user/${user.id}`)
    .set("Authorization", "Bearer " + (await loginAdmin()));

  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toMatchObject({ message: "user deleted" });

  const loginRes = await request(app).put("/api/auth").send(user);
  expect(loginRes.status).toBe(404);
});

test("delete user - admin cannot delete themselves", async () => {
  const adminToken = await loginAdmin();
  const meRes = await request(app).get("/api/user/me").set("Authorization", "Bearer " + adminToken);
  const deleteRes = await request(app)
    .delete(`/api/user/${meRes.body.id}`)
    .set("Authorization", "Bearer " + adminToken);

  expect(deleteRes.status).toBe(403);
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9-_]*\.[a-zA-Z0-9-_]*\.[a-zA-Z0-9-_]*$/);
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

test("list users unauthorized", async () => {
  const listUsersRes = await request(app).get("/api/user");
  expect(listUsersRes.status).toBe(401);
});

test("list users - not admin", async () => {
  const [, userToken] = await registerUser(request(app));
  const listUsersRes = await request(app)
    .get("/api/user")
    .set("Authorization", "Bearer " + userToken);
  expect(listUsersRes.status).toBe(403);
});

test("list users - admin", async () => {
  const listUsersRes = await request(app)
    .get("/api/user")
    .set("Authorization", "Bearer " + (await loginAdmin()));

  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body).toMatchObject({
    users: expect.any(Array),
    more: expect.any(Boolean),
  });
  expect(listUsersRes.body.users.length).toBeGreaterThan(0);
  for (const listedUser of listUsersRes.body.users) {
    expect(listedUser).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      email: expect.any(String),
      roles: expect.any(Array),
    });
    expect(listedUser.password).toBeUndefined();
  }
});

test("list users - name filter", async () => {
  const name = `filter ${randomName()}`;
  const [user] = await registerUser(request(app), name);
  const listUsersRes = await request(app)
    .get(`/api/user?name=${encodeURIComponent(name)}`)
    .set("Authorization", "Bearer " + (await loginAdmin()));

  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body).toEqual({
    users: [{ id: user.id, name, email: user.email, roles: [{ role: "diner" }] }],
    more: false,
  });
});

test("list users - wildcard filter", async () => {
  const prefix = `wild${randomName()}`;
  await registerUser(request(app), `${prefix} one`);
  await registerUser(request(app), `${prefix} two`);
  const listUsersRes = await request(app)
    .get(`/api/user?name=${prefix}*`)
    .set("Authorization", "Bearer " + (await loginAdmin()));

  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users.map((u) => u.name)).toEqual([`${prefix} one`, `${prefix} two`]);
});

test("list users - pagination", async () => {
  const prefix = `page${randomName()}`;
  for (let i = 1; i <= 3; i++) {
    await registerUser(request(app), `${prefix} ${i}`);
  }
  const adminToken = await loginAdmin();

  const page1Res = await request(app)
    .get(`/api/user?page=1&limit=2&name=${prefix}*`)
    .set("Authorization", "Bearer " + adminToken);
  expect(page1Res.status).toBe(200);
  expect(page1Res.body.users.map((u) => u.name)).toEqual([`${prefix} 1`, `${prefix} 2`]);
  expect(page1Res.body.more).toBe(true);

  const page2Res = await request(app)
    .get(`/api/user?page=2&limit=2&name=${prefix}*`)
    .set("Authorization", "Bearer " + adminToken);
  expect(page2Res.status).toBe(200);
  expect(page2Res.body.users.map((u) => u.name)).toEqual([`${prefix} 3`]);
  expect(page2Res.body.more).toBe(false);
});

test("list users - bad page and limit are sanitized", async () => {
  const name = `bad${randomName()}`;
  await registerUser(request(app), name);
  const listUsersRes = await request(app)
    .get(`/api/user?page=abc&limit=1;DROP TABLE user&name=${name}`)
    .set("Authorization", "Bearer " + (await loginAdmin()));

  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users.map((u) => u.name)).toEqual([name]);
});

async function loginAdmin() {
  const admin = { name: randomName(), password: "toomanysecrets", roles: [{ role: Role.Admin }] };
  admin.email = `${admin.name}@admin.com`;
  await DB.addUser(admin);

  const loginRes = await request(app).put("/api/auth").send({ email: admin.email, password: admin.password });
  return loginRes.body.token;
}

async function registerUser(service, name = "pizza diner") {
  const testUser = {
    name,
    email: `${randomName()}@test.com`,
    password: "a",
  };
  const registerRes = await service.post("/api/auth").send(testUser);
  registerRes.body.user.password = testUser.password;

  return [registerRes.body.user, registerRes.body.token];
}
