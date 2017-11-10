const express = require("express");
const fetch = require("node-fetch");
const parser = require("xml2json");
const format = require("date-fns/format");
const parse = require("date-fns/parse");
const addMinutes = require("date-fns/add_minutes");

const formatTime = date => format(date, "HH:mm");

const app = express();
const router = express.Router();

app.use(
  process.env.PASSENGER_BASE_URI ? process.env.PASSENGER_BASE_URI : "/",
  router
);

const getStationDataUrl = (from, to) =>
  `http://www.labs.skanetrafiken.se/v2.2/querypage.asp?inpPointFr=${from}&inpPointTo=${to}`;

const getResultsUrl = (from, to) =>
  `http://www.labs.skanetrafiken.se/v2.2/resultspage.asp?cmdaction=next&selPointFr=${encodeURIComponent(
    from.name
  )}|${from.id}|0&selPointTo=${encodeURIComponent(
    to.name
  )}|${to.id}|0&LastStart=${encodeURIComponent(
    format(new Date(), "YYYY-MM-DD HH:mm")
  )}`;

const parseStationData = json => ({
  from: {
    name: json.StartPoints.Point[0].Name,
    id: json.StartPoints.Point[0].Id
  },
  to: {
    name: json.EndPoints.Point[0].Name,
    id: json.EndPoints.Point[0].Id
  }
});

const parseJourney = (from, to, journey) => {
  const departure = parse(journey.DepDateTime);
  const arrival = parse(journey.ArrDateTime);
  const data = {
    departureName: from.name,
    departure: formatTime(departure),
    arrival: formatTime(arrival),
    arrivalName: to.name
  };

  const realTime = journey.RouteLinks.RouteLink.RealTime
    ? journey.RouteLinks.RouteLink.RealTime.RealTimeInfo
    : undefined;

  if (realTime && realTime.DepTimeDeviation && realTime.DepTimeDeviation > 0) {
    data.delayedDeparture = formatTime(
      addMinutes(departure, realTime.DepTimeDeviation)
    );
    data.arrival = formatTime(addMinutes(arrival, realTime.DepTimeDeviation));
    if (realTime && realTime.ArrTimeDeviation) {
      data.arrival = formatTime(addMinutes(arrival, realTime.ArrTimeDeviation));
    }
  }

  return data;
};

const getStationData = async ({ from = "Malmö C", to = "kävlinge Station" }) =>
  fetch(getStationDataUrl(from, to))
    .then(r => r.text())
    .then(t => parser.toJson(t, { object: true }))
    .then(
      json =>
        json["soap:Envelope"]["soap:Body"]["GetStartEndPointResponse"][
          "GetStartEndPointResult"
        ]
    )
    .then(parseStationData);

const getTravelData = async ({ from, to }) =>
  fetch(getResultsUrl(from, to))
    .then(r => r.text())
    .then(t => parser.toJson(t, { object: true }))
    .then(json =>
      json["soap:Envelope"]["soap:Body"]["GetJourneyResponse"][
        "GetJourneyResult"
      ]["Journeys"]["Journey"].map(parseJourney.bind(this, from, to))
    );

const formatMessage = data => {
  const delay = data.delayedDeparture
    ? ` som är försenad till ${data.delayedDeparture}`
    : "";
  return `Är på väg till ${data.departureName} avgång ${data.departure}${delay}. Beräknad ankomst ${data.arrivalName} ${data.arrival}.`;
};

router.get("/", async (req, res) => {
  try {
    const stationData = await getStationData(req.query);
    const travelData = await getTravelData(stationData);
    if (req.query.formatMessage === "true") {
      res.send(formatMessage(travelData[0]));
    } else {
      res.send(JSON.stringify(travelData));
    }
  } catch (e) {
    res.send(e.message);
  }
});

app.listen(3000);
