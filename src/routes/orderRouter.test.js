//authRouter.js      |   89.36 |    73.33 |      80 |   93.33 | 44,53,64
const request = require("supertest");
const app = require("../service");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;

beforeAll(async () => {
  //registers an example user
  testUser.email = Math.random().toString(36).substring(2, 12) + "@test.com";
  const registerRes = await request(app).post("/api/auth").send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
  //logs in the example user
  const loginRes = await request(app).put("/api/auth").send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);
});

test("get menu", async () => {
  const menuRes = await request(app).get("/api/order/menu");
  expect(menuRes.status).toBe(200);
  expect(Array.isArray(menuRes.body)).toBe(true);
  expect(menuRes.body.length).toBeGreaterThan(0);
  expect(menuRes.body[0]).toMatchObject({
    id: expect.any(Number),
    title: expect.any(String),
    image: expect.any(String),
    price: expect.any(Number),
    description: expect.any(String),
  });
});

test("add to menu - not admin", async () => {
  const newPizza = {
    title: "Saucy",
    image: "pizza.png",
    price: 0.02,
    description: "nothing except sauce",
  };
  //without sending a token the response is 401, with a token it will process and say you're not an admin
  const menuRes = await request(app).put("/api/order/menu").set("Authorization", `Bearer ${testUserAuthToken}`).send(newPizza);
  expect(menuRes.status).toBe(403);
});

test("add to menu - admin", () => {});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}
