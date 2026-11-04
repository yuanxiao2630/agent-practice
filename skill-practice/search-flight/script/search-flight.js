const RightFlight = {
  "success": true,
  "data": [
    {
      "flight_no": "CA1234",
      "depart_time": "08:30",
      "arrive_time": "10:45",
      "price": 860,
      "airline": "国航"
    },
    {
      "flight_no": "MU5678",
      "depart_time": "14:00",
      "arrive_time": "16:20",
      "price": 720,
      "airline": "东航"
    }
  ],
  "tip": "价格为预估裸票价，不含基建燃油"
}

const WrongFlight = {
  "success": false,
  "error_msg": "出发和到达城市不能相同，请重新选择",
  "code": "INVALID_CITY"
}

function getFlightPrice(from_city, to_city, data, cabin = 'economy') {
    if (from_city != '' && to_city != '' && data != '') {
        return RightFlight
    } else {
        return WrongFlight
    }
}