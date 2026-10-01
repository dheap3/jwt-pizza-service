//authRouter.js      |   89.36 |    73.33 |      80 |   93.33 | 44,53,64
const request = require("supertest");
const app = require("../service");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + "@test.com";
  const registerRes = await request(app).post("/api/auth").send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test("login", async () => {
  const loginRes = await request(app).put("/api/auth").send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: "diner" }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test("logout", async () => {
  const loginRes = await request(app).put("/api/auth").send(testUser);
  const authToken = loginRes.body.token;

  const logoutRes = await request(app).delete("/api/auth").set("Authorization", `Bearer ${authToken}`);

  expect(logoutRes.status).toBe(200);
  expect(logoutRes.body.message).toMatch("logout successful");
});

//doesn't get more line coverage, this needs to be tested with database
test("loginNullUser", async () => {
  const loginRes = await request(app).put("/api/auth").send(null);
  expect(loginRes.status).toBe(500);
  expect(loginRes.body.token).toBeUndefined();
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}