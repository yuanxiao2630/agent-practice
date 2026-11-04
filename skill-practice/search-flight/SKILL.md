---
name: search-flight
description: 根据出发城市、到达城市、出发时间查询机票价格。
---

# search-flight

## Overview

这个 skill 的作用是根据出发城市、到达城市、出发时间来查询机票价格；默认查询经济舱价钱，如果需要查询头等舱价钱，需要特别说明。
如果用户需要查询机票价钱，请使用这个 skill。

## Quick Start

如果你需要查询机票，请调用 `script/search-flight.js`。从用户的对话中提取出下面的信息，然后传参给 getFlightPrice 这个函数，将结果返回给用户。

提取信息：
参数名	类型	是否必填	说明	约束
from_city	string	是	出发城市中文名	枚举：北京、上海、广州、深圳、杭州、成都
to_city	string	是	到达城市中文名	和出发城市不能相同
travel_date	string	是	出行日期	格式 YYYY-MM-DD，只能查未来 7 天内的日期
cabin	string	否	舱位	枚举：economy 经济舱 /business 商务舱，默认 economy

## 异常情况

1. from_city 和 to_city 一样 → 报错：出发和到达城市不能相同，请重新选择
2. travel_date 格式不对，不是 YYYY-MM-DD → 报错：日期格式错误，请使用 YYYY-MM-DD
3. 日期是过去的 / 超过 7 天以后 → 报错：仅支持查询未来 7 天内的航班
4. 城市不在枚举列表内 → 报错：暂不支持该城市，支持城市：北京、上海、广州、深圳、杭州、成都
5. cabin 传了不在枚举的值 → 自动兜底为经济舱，同时在 tip 提示用户