const request = require("supertest");
const app = require("../service");

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

test("delete user", async () => {
  const userRes = await request(app).delete(`/api/user/${testUserId}`).set("Authorization", `Bearer ${testUserAuthToken}`);

  expect(userRes.status).toBe(200);
});

test("list users", async () => {
  const userRes = await request(app).get("/api/user").set("Authorization", `Bearer ${testUserAuthToken}`);

  expect(userRes.status).toBe(200);
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9-_]*\.[a-zA-Z0-9-_]*\.[a-zA-Z0-9-_]*$/);
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}
